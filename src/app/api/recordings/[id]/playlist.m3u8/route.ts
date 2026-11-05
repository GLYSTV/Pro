import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { recordingDir } from "@/lib/recorder";

export const dynamic = "force-dynamic";

/** Serves the local HLS playlist of a recording, pointing segments at the segments route. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("ID inválido", { status: 400 });

  const [rec] = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.profileId, auth.profile.id)))
    .limit(1);
  if (!rec) return new Response("Grabación no encontrada", { status: 404 });

  let text: string;
  try {
    text = await fs.readFile(path.join(recordingDir(id), "index.m3u8"), "utf8");
  } catch {
    return new Response("La grabación todavía no tiene datos", { status: 404 });
  }

  const rewritten = text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return trimmed.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="/api/recordings/${id}/segments/${uri}"`);
      }
      return `/api/recordings/${id}/segments/${trimmed}`;
    })
    .join("\n");

  return new Response(rewritten, {
    headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
  });
}
