import { createDecipheriv } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { readSegmentsMeta, recordingDir } from "@/lib/recorder";

export const dynamic = "force-dynamic";

/** Streams the whole recording as a single (decrypted) TS or fMP4 file. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("ID inválido", { status: 400 });

  const [rec] = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.profileId, auth.profile.id)))
    .limit(1);
  if (!rec) return new Response("Grabación no encontrada", { status: 404 });

  const segments = await readSegmentsMeta(id);
  if (segments.length === 0) return new Response("La grabación no tiene datos", { status: 404 });
  const dir = recordingDir(id);
  const keyCache = new Map<string, Buffer>();

  async function* chunks() {
    let lastMap = "";
    for (const seg of segments) {
      if (seg.map && seg.map !== lastMap) {
        yield await fs.readFile(path.join(dir, seg.map));
        lastMap = seg.map;
      }
      let data = await fs.readFile(path.join(dir, seg.file));
      if (seg.key && seg.iv) {
        let key = keyCache.get(seg.key);
        if (!key) {
          key = await fs.readFile(path.join(dir, seg.key));
          keyCache.set(seg.key, key);
        }
        const iv = Buffer.from(seg.iv.replace(/^0x/i, "").padStart(32, "0"), "hex");
        const decipher = createDecipheriv("aes-128-cbc", key, iv);
        data = Buffer.concat([decipher.update(data), decipher.final()]);
      }
      yield data;
    }
  }

  const safeTitle = rec.title.replace(/[^\p{L}\p{N}\s.-]+/gu, "").trim().slice(0, 80) || "grabacion";
  const ext = rec.container === "mp4" ? "mp4" : "ts";
  const asciiName = safeTitle.normalize("NFD").replace(/[^\x20-\x7e]/g, "") || "grabacion";
  const stream = Readable.toWeb(Readable.from(chunks())) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": rec.container === "mp4" ? "video/mp4" : "video/MP2T",
      "content-disposition": `attachment; filename="${asciiName}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.${ext}`)}`,
      "cache-control": "no-store",
    },
  });
}
