import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { recordingDir } from "@/lib/recorder";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".ts": "video/MP2T",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".bin": "application/octet-stream",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; name: string }> }) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const { id: rawId, name } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !/^[\w.-]+$/.test(name) || name.includes("..")) {
    return new Response("Petición inválida", { status: 400 });
  }
  const [rec] = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.profileId, auth.profile.id)))
    .limit(1);
  if (!rec) return new Response("Grabación no encontrada", { status: 404 });

  const file = path.join(recordingDir(id), name);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return new Response("Segmento no encontrado", { status: 404 });
  }
  const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": TYPES[path.extname(name)] ?? "application/octet-stream",
      "content-length": String(stat.size),
      "cache-control": "private, max-age=3600",
    },
  });
}
