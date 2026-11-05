import { gunzipSync } from "node:zlib";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { channels, epgSources, programs } from "@/db/schema";

const MAX_BYTES = 80 * 1024 * 1024; // decompressed
const MAX_PROGRAMS = 200_000;

export interface XmltvChannel {
  id: string;
  names: string[];
  icon?: string;
}

export interface XmltvProgramme {
  channel: string;
  start: Date;
  stop: Date;
  title: string;
  desc?: string;
  category?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** Parses XMLTV timestamps such as `20240501183000 +0200`. */
export function parseXmltvDate(raw: string): Date | null {
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*([+-]\d{4})?/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", tz] = m;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (tz) {
    const sign = tz[0] === "-" ? -1 : 1;
    const offset = (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10)) * 60_000;
    ms -= sign * offset;
  }
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function tagText(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  return m ? decodeXml(m[1]) : undefined;
}

export function parseXmltvChannels(xml: string): Map<string, XmltvChannel> {
  const result = new Map<string, XmltvChannel>();
  const re = /<channel\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const id = decodeXml(m[1]);
    const body = m[2];
    const names = [...body.matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/gi)]
      .map((x) => decodeXml(x[1]))
      .filter(Boolean);
    const icon = /<icon[^>]*src="([^"]*)"/i.exec(body)?.[1];
    result.set(id, { id, names, icon: icon ? decodeXml(icon) : undefined });
  }
  return result;
}

export function parseXmltvProgrammes(
  xml: string,
  opts: { from: Date; to: Date; filter?: (channelId: string) => boolean; limit?: number },
): XmltvProgramme[] {
  const programmes: XmltvProgramme[] = [];
  const re = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/gi;
  const fromMs = opts.from.getTime();
  const toMs = opts.to.getTime();
  const limit = opts.limit ?? MAX_PROGRAMS;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const channelRaw = /channel="([^"]*)"/i.exec(attrs)?.[1];
    if (!channelRaw) continue;
    const channel = decodeXml(channelRaw);
    if (opts.filter && !opts.filter(channel)) continue;
    const start = parseXmltvDate(/start="([^"]*)"/i.exec(attrs)?.[1] ?? "");
    const stop = parseXmltvDate(/stop="([^"]*)"/i.exec(attrs)?.[1] ?? "");
    if (!start || !stop || stop <= start) continue;
    if (stop.getTime() < fromMs || start.getTime() > toMs) continue;
    const body = m[2];
    programmes.push({
      channel,
      start,
      stop,
      title: tagText(body, "title") || "Sin título",
      desc: tagText(body, "desc"),
      category: tagText(body, "category"),
    });
    if (programmes.length >= limit) break;
  }
  return programmes;
}

/** Normalises channel names so "La 1 HD (1080p)" and "la1" compare equal. */
export function normalizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(uhd|fhd|hd|sd|4k|8k|hevc|h265|h\.265|h264|1080p|1080i|720p|576p|480p|360p|raw|backup|alt)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

export async function fetchXmltv(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GLYSTV-PRO/1.0)", Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("El archivo XMLTV supera el tamaño máximo (80 MB)");
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = gunzipSync(buf, { maxOutputLength: MAX_BYTES });
  }
  const text = buf.toString("utf8");
  if (!/<tv[\s>]/i.test(text.slice(0, 4096)) && !/<programme/i.test(text)) {
    throw new Error("El contenido no parece un archivo XMLTV");
  }
  return text;
}

export interface EpgImportResult {
  matchedChannels: number;
  programs: number;
  xmlChannels: number;
}

/**
 * Downloads an XMLTV source, matches its channels against the catalogue
 * (by tvg-id first, then by normalised display name) and replaces the stored
 * schedule for every matched channel in the covered time range.
 */
export async function importEpgSource(sourceId: number): Promise<EpgImportResult> {
  const [source] = await db.select().from(epgSources).where(eq(epgSources.id, sourceId)).limit(1);
  if (!source) throw new Error("Fuente EPG no encontrada");

  try {
    const xml = await fetchXmltv(source.url);

    const catalogue = await db
      .select({ id: channels.id, name: channels.name, tvgId: channels.tvgId })
      .from(channels)
      .where(source.userId != null ? eq(channels.userId, source.userId) : undefined);
    const byTvg = new Map<string, number[]>();
    const byName = new Map<string, number[]>();
    const push = (map: Map<string, number[]>, key: string, id: number) => {
      if (!key) return;
      const list = map.get(key);
      if (list) list.push(id);
      else map.set(key, [id]);
    };
    for (const c of catalogue) {
      if (c.tvgId) push(byTvg, c.tvgId.trim().toLowerCase(), c.id);
      push(byName, normalizeChannelName(c.name), c.id);
    }

    const xmlChannels = parseXmltvChannels(xml);
    const mapping = new Map<string, number[]>();
    for (const [id, ch] of xmlChannels) {
      let ids = byTvg.get(id.toLowerCase());
      if (!ids) {
        for (const n of ch.names) {
          ids = byName.get(normalizeChannelName(n));
          if (ids) break;
        }
      }
      if (ids) mapping.set(id, ids);
    }
    const resolve = (xmlId: string) => mapping.get(xmlId) ?? byTvg.get(xmlId.toLowerCase());

    const from = new Date(Date.now() - 6 * 3_600_000);
    const to = new Date(Date.now() + 7 * 86_400_000);
    const programmes = parseXmltvProgrammes(xml, { from, to, filter: (id) => Boolean(resolve(id)) });

    const rows: Array<typeof programs.$inferInsert> = [];
    const touched = new Set<number>();
    let minStart = Number.POSITIVE_INFINITY;
    let maxStop = Number.NEGATIVE_INFINITY;
    for (const p of programmes) {
      const ids = resolve(p.channel) ?? [];
      for (const channelId of ids) {
        touched.add(channelId);
        minStart = Math.min(minStart, p.start.getTime());
        maxStop = Math.max(maxStop, p.stop.getTime());
        rows.push({
          channelId,
          title: p.title.slice(0, 300),
          description: p.desc ? p.desc.slice(0, 2000) : null,
          genre: p.category ? p.category.slice(0, 80) : null,
          startTime: p.start,
          endTime: p.stop,
          source: "xmltv",
          epgSourceId: sourceId,
        });
      }
      if (rows.length >= MAX_PROGRAMS) break;
    }

    if (touched.size > 0 && rows.length > 0) {
      const ids = [...touched];
      for (let i = 0; i < ids.length; i += 1000) {
        await db
          .delete(programs)
          .where(
            and(
              inArray(programs.channelId, ids.slice(i, i + 1000)),
              lt(programs.startTime, new Date(maxStop)),
              gt(programs.endTime, new Date(minStart)),
            ),
          );
      }
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(programs).values(rows.slice(i, i + 500));
      }
    }

    await db
      .update(epgSources)
      .set({
        lastFetchedAt: new Date(),
        channelCount: touched.size,
        programCount: rows.length,
        lastError: null,
      })
      .where(eq(epgSources.id, sourceId));

    return { matchedChannels: touched.size, programs: rows.length, xmlChannels: xmlChannels.size };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(epgSources).set({ lastError: message.slice(0, 500) }).where(eq(epgSources.id, sourceId));
    throw err;
  }
}
