import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { playlists } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { fetchPlaylistText, importEntries, pruneEmptyCustomCategories } from "@/lib/import";
import { parseM3U } from "@/lib/m3u";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  // channels cascade-delete through the FK
  const [deleted] = await db
    .delete(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.userId, auth.user.id)))
    .returning({ id: playlists.id });
  if (!deleted) return NextResponse.json({ error: "Lista no encontrada" }, { status: 404 });
  await pruneEmptyCustomCategories();
  return NextResponse.json({ ok: true });
}

/** Re-downloads a URL-based playlist and updates its channels in place. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const [playlist] = await db
    .select()
    .from(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.userId, auth.user.id)))
    .limit(1);
  if (!playlist) return NextResponse.json({ error: "Lista no encontrada" }, { status: 404 });
  if (playlist.kind !== "m3u" || !playlist.sourceUrl) {
    return NextResponse.json({ error: "Solo se pueden actualizar listas importadas desde una URL" }, { status: 400 });
  }

  let text: string;
  try {
    text = await fetchPlaylistText(playlist.sourceUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `No se pudo descargar la lista: ${message}` }, { status: 502 });
  }
  const entries = parseM3U(text);
  if (entries.length === 0) {
    return NextResponse.json({ error: "La lista descargada no contiene canales" }, { status: 422 });
  }
  const result = await importEntries(entries, {
    userId: auth.user.id,
    name: playlist.name,
    sourceUrl: playlist.sourceUrl,
    kind: "m3u",
    playlistId: playlist.id,
  });
  await pruneEmptyCustomCategories();
  return NextResponse.json(result);
}
