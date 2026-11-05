import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { bootstrap } from "@/db/bootstrap";
import { recordings, type Recording } from "@/db/schema";

/** Base folder for recordings: `RECORDINGS_DIR` env var or `./data/recordings` (resolved at runtime). */
function recordingsRoot(): string {
  const configured = process.env.RECORDINGS_DIR;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.resolve("data", "recordings");
}
export const MAX_CONCURRENT_RECORDINGS = 3;
export const MAX_RECORDING_MINUTES = 240;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface SegmentMeta {
  file: string;
  duration: number;
  seq: number;
  discontinuity?: boolean;
  map?: string;
  key?: string;
  iv?: string;
  method?: string;
}

interface Job {
  id: number;
  cancelled: boolean;
  wake?: () => void;
  promise: Promise<void>;
}

interface Registry {
  jobs: Map<number, Job>;
  timer?: ReturnType<typeof setInterval>;
  ticking: boolean;
}

// Kept on globalThis so API routes and the instrumentation hook share one registry.
const g = globalThis as typeof globalThis & { __glystvRecorder?: Registry };
function registry(): Registry {
  if (!g.__glystvRecorder) g.__glystvRecorder = { jobs: new Map(), ticking: false };
  return g.__glystvRecorder;
}

export function recordingDir(id: number) {
  // Paths are resolved at runtime; keep the bundler's file tracer away from them.
  return path.join(/*turbopackIgnore: true*/ recordingsRoot(), String(id));
}

export function isRecordingActive(id: number) {
  return registry().jobs.has(id);
}

export function startScheduler() {
  const r = registry();
  if (r.timer) return;
  r.timer = setInterval(() => void tick(), 15_000);
  void tick();
}

/** Starts due recordings and finalises stale ones. Safe to call at any time. */
export async function tick() {
  const r = registry();
  if (r.ticking) return;
  r.ticking = true;
  try {
    await bootstrap();
    const now = new Date();

    await db
      .update(recordings)
      .set({ status: "failed", error: "La grabación no pudo iniciarse a tiempo" })
      .where(and(eq(recordings.status, "scheduled"), lte(recordings.endTime, now)));

    const due = await db
      .select()
      .from(recordings)
      .where(
        and(
          inArray(recordings.status, ["scheduled", "recording"]),
          lte(recordings.startTime, now),
          gt(recordings.endTime, now),
        ),
      );
    for (const rec of due) {
      if (r.jobs.has(rec.id)) continue;
      if (r.jobs.size >= MAX_CONCURRENT_RECORDINGS) break;
      launch(rec);
    }

    const stale = await db
      .select()
      .from(recordings)
      .where(and(eq(recordings.status, "recording"), lte(recordings.endTime, now)));
    for (const rec of stale) {
      if (r.jobs.has(rec.id)) continue;
      await finalize(rec.id, rec.segmentCount > 0 ? "completed" : "failed", rec.segmentCount > 0 ? null : "Sin datos grabados");
    }
  } catch (err) {
    console.error("[recorder] tick failed", err);
  } finally {
    r.ticking = false;
  }
}

function launch(rec: Recording) {
  const r = registry();
  const job: Job = { id: rec.id, cancelled: false, promise: Promise.resolve() };
  r.jobs.set(rec.id, job);
  job.promise = runJob(rec, job)
    .catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[recorder] job ${rec.id} failed:`, message);
      await finalize(rec.id, "failed", message.slice(0, 500));
    })
    .finally(() => {
      r.jobs.delete(rec.id);
    });
}

/** Stops an in-progress recording (keeps what was captured). */
export async function stopRecording(id: number): Promise<boolean> {
  const job = registry().jobs.get(id);
  if (!job) return false;
  job.cancelled = true;
  job.wake?.();
  await job.promise;
  return true;
}

export async function deleteRecordingFiles(id: number) {
  await fs.rm(recordingDir(id), { recursive: true, force: true });
}

async function finalize(id: number, status: "completed" | "failed", error: string | null) {
  await db.update(recordings).set({ status, error }).where(eq(recordings.id, id));
}

// ───────── HLS helpers ─────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  return res.text();
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar segmento`);
  return Buffer.from(await res.arrayBuffer());
}

function parseAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of line.matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) {
    attrs[m[1]] = m[3] ?? m[2];
  }
  return attrs;
}

/** Picks a media playlist out of a master playlist (best quality up to ~3 Mbps). */
async function resolveMediaPlaylist(url: string, depth = 0): Promise<{ url: string; text: string }> {
  const text = await fetchText(url);
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("La señal no es un stream HLS válido");
  if (!/#EXT-X-STREAM-INF/i.test(text)) return { url, text };
  if (depth > 2) throw new Error("Demasiados niveles de playlist");

  const lines = text.split(/\r?\n/);
  const variants: Array<{ bandwidth: number; uri: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const attrs = parseAttrs(lines[i]);
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || lines[j].startsWith("#"))) j++;
    if (j < lines.length) {
      variants.push({
        bandwidth: Number(attrs.AVERAGE_BANDWIDTH ?? attrs["AVERAGE-BANDWIDTH"] ?? attrs.BANDWIDTH ?? 0),
        uri: new URL(lines[j].trim(), url).toString(),
      });
    }
  }
  if (variants.length === 0) throw new Error("La playlist maestra no contiene variantes");
  variants.sort((a, b) => a.bandwidth - b.bandwidth);
  const preferred = [...variants].reverse().find((v) => v.bandwidth <= 3_000_000) ?? variants[0];
  // Try the preferred variant first, then the rest (highest quality first) in case some are broken.
  const order = [preferred, ...[...variants].reverse().filter((v) => v !== preferred)];
  let lastError: unknown = null;
  for (const variant of order) {
    try {
      return await resolveMediaPlaylist(variant.uri, depth + 1);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Ninguna variante de la señal está disponible");
}

interface ParsedSegment {
  url: string;
  duration: number;
  seq: number;
  discontinuity: boolean;
  mapUri?: string;
  keyMethod?: string;
  keyUri?: string;
  keyIv?: string;
}

function parseMediaPlaylist(text: string, baseUrl: string) {
  const lines = text.split(/\r?\n/);
  let targetDuration = 6;
  let mediaSequence = 0;
  let endList = false;
  let pendingDuration = 0;
  let pendingDiscontinuity = false;
  let mapUri: string | undefined;
  let key: { method: string; uri?: string; iv?: string } | undefined;
  const segments: ParsedSegment[] = [];

  const abs = (ref: string) => new URL(ref, baseUrl).toString();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-TARGETDURATION:")) targetDuration = Number(line.split(":")[1]) || targetDuration;
    else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) mediaSequence = Number(line.split(":")[1]) || 0;
    else if (line.startsWith("#EXT-X-ENDLIST")) endList = true;
    else if (line.startsWith("#EXTINF:")) pendingDuration = parseFloat(line.slice(8)) || 0;
    else if (line.startsWith("#EXT-X-DISCONTINUITY")) pendingDiscontinuity = true;
    else if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = parseAttrs(line.slice(11));
      if (attrs.URI) mapUri = abs(attrs.URI);
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseAttrs(line.slice(11));
      key = attrs.METHOD && attrs.METHOD !== "NONE" ? { method: attrs.METHOD, uri: attrs.URI ? abs(attrs.URI) : undefined, iv: attrs.IV } : undefined;
    } else if (!line.startsWith("#")) {
      segments.push({
        url: abs(line),
        duration: pendingDuration,
        seq: mediaSequence + segments.length,
        discontinuity: pendingDiscontinuity,
        mapUri,
        keyMethod: key?.method,
        keyUri: key?.uri,
        keyIv: key?.iv,
      });
      pendingDuration = 0;
      pendingDiscontinuity = false;
    }
  }
  return { targetDuration, mediaSequence, endList, segments };
}

function ivForSegment(seg: { iv?: string; seq: number }): string {
  if (seg.iv) return seg.iv.toLowerCase().startsWith("0x") ? seg.iv : `0x${seg.iv}`;
  return `0x${seg.seq.toString(16).padStart(32, "0")}`;
}

/** Writes the local VOD/EVENT playlist that the player consumes. */
export async function writeLocalPlaylist(dir: string, segments: SegmentMeta[], targetDuration: number, finished: boolean) {
  const lines = ["#EXTM3U", `#EXT-X-VERSION:${segments.some((s) => s.map) ? 6 : 3}`];
  const maxDur = Math.max(targetDuration, ...segments.map((s) => s.duration));
  lines.push(`#EXT-X-TARGETDURATION:${Math.ceil(maxDur || 6)}`);
  lines.push("#EXT-X-MEDIA-SEQUENCE:0");
  lines.push(`#EXT-X-PLAYLIST-TYPE:${finished ? "VOD" : "EVENT"}`);
  let lastKey = "";
  let lastMap = "";
  for (const s of segments) {
    if (s.discontinuity) lines.push("#EXT-X-DISCONTINUITY");
    const keySig = s.key ? `${s.method}|${s.key}|${s.iv}` : "";
    if (keySig !== lastKey) {
      lines.push(s.key ? `#EXT-X-KEY:METHOD=${s.method ?? "AES-128"},URI="${s.key}",IV=${s.iv}` : "#EXT-X-KEY:METHOD=NONE");
      lastKey = keySig;
    }
    if ((s.map ?? "") !== lastMap) {
      if (s.map) lines.push(`#EXT-X-MAP:URI="${s.map}"`);
      lastMap = s.map ?? "";
    }
    lines.push(`#EXTINF:${s.duration.toFixed(3)},`);
    lines.push(s.file);
  }
  if (finished) lines.push("#EXT-X-ENDLIST");
  const tmp = path.join(dir, "index.m3u8.tmp");
  await fs.writeFile(tmp, lines.join("\n") + "\n");
  await fs.rename(tmp, path.join(dir, "index.m3u8"));
}

export async function readSegmentsMeta(id: number): Promise<SegmentMeta[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(recordingDir(id), "segments.json"), "utf8")) as SegmentMeta[];
  } catch {
    return [];
  }
}

function sleep(job: Job, ms: number) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      job.wake = undefined;
      resolve();
    }, ms);
    job.wake = () => {
      clearTimeout(t);
      job.wake = undefined;
      resolve();
    };
  });
}

async function runJob(rec: Recording, job: Job) {
  const dir = recordingDir(rec.id);
  await fs.mkdir(dir, { recursive: true });
  await db.update(recordings).set({ status: "recording", error: null }).where(eq(recordings.id, rec.id));

  const metaPath = path.join(dir, "segments.json");
  const segments = await readSegmentsMeta(rec.id);
  const resumed = segments.length > 0;
  let sizeBytes = rec.sizeBytes ?? 0;
  let duration = segments.reduce((a, s) => a + s.duration, 0);
  let container = rec.container;

  const media = await resolveMediaPlaylist(rec.streamUrl);
  const mediaUrl = media.url;
  let firstPass = true;
  let lastSeq = -1;
  let targetDuration = 6;
  let consecutiveErrors = 0;
  let mapFile: string | null = segments.find((s) => s.map)?.map ?? null;
  const keyFiles = new Map<string, string>();
  const endMs = rec.endTime.getTime();

  while (!job.cancelled && Date.now() < endMs) {
    try {
      const text = firstPass && media.text ? media.text : await fetchText(mediaUrl);
      const parsed = parseMediaPlaylist(text, mediaUrl);
      targetDuration = parsed.targetDuration || targetDuration;

      let fresh = parsed.segments.filter((s) => s.seq > lastSeq);
      if (firstPass) {
        // Start close to the live edge (keep ~3 segments of backlog) unless the source is VOD.
        if (!parsed.endList) fresh = fresh.slice(-3);
        firstPass = false;
      }

      for (const s of fresh) {
        if (job.cancelled || Date.now() >= endMs) break;

        let keyFile: string | undefined;
        if (s.keyUri && s.keyMethod && s.keyMethod !== "NONE") {
          keyFile = keyFiles.get(s.keyUri);
          if (!keyFile) {
            const buf = await fetchBuffer(s.keyUri);
            keyFile = `key-${keyFiles.size + 1}.bin`;
            await fs.writeFile(path.join(dir, keyFile), buf);
            keyFiles.set(s.keyUri, keyFile);
          }
        }

        let segMap: string | undefined;
        if (s.mapUri) {
          if (!mapFile) {
            const buf = await fetchBuffer(s.mapUri);
            mapFile = "init.mp4";
            await fs.writeFile(path.join(dir, mapFile), buf);
          }
          segMap = mapFile;
          container = "mp4";
        } else if (/\.(m4s|mp4)(\?|#|$)/i.test(s.url)) {
          container = "mp4";
        }

        const buf = await fetchBuffer(s.url);
        const ext = container === "mp4" ? "m4s" : "ts";
        const file = `seg-${String(segments.length + 1).padStart(5, "0")}.${ext}`;
        await fs.writeFile(path.join(dir, file), buf);

        segments.push({
          file,
          duration: s.duration,
          seq: s.seq,
          discontinuity: s.discontinuity || (resumed && lastSeq === -1) || undefined,
          map: segMap,
          key: keyFile,
          iv: keyFile ? ivForSegment({ iv: s.keyIv, seq: s.seq }) : undefined,
          method: keyFile ? s.keyMethod : undefined,
        });
        sizeBytes += buf.byteLength;
        duration += s.duration;
        lastSeq = s.seq;

        await writeLocalPlaylist(dir, segments, targetDuration, false);
        await fs.writeFile(metaPath, JSON.stringify(segments));
        await db
          .update(recordings)
          .set({ segmentCount: segments.length, sizeBytes, durationSeconds: Math.round(duration), container })
          .where(eq(recordings.id, rec.id));
      }
      consecutiveErrors = 0;
      if (parsed.endList) break; // VOD source: nothing more to capture
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= 12) {
        throw new Error(`Demasiados errores consecutivos: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!job.cancelled && Date.now() < endMs) {
      await sleep(job, Math.max(2_000, Math.min(targetDuration * 500, 10_000)));
    }
  }

  await writeLocalPlaylist(dir, segments, targetDuration, true);
  await fs.writeFile(metaPath, JSON.stringify(segments));
  await finalize(
    rec.id,
    segments.length > 0 ? "completed" : "failed",
    segments.length > 0 ? null : "No se recibió ningún segmento de la señal",
  );
}
