import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { playlists } from "@/db/schema";
import { apiProfile, apiUser } from "@/lib/auth";
import { fetchPlaylistText, importEntries } from "@/lib/import";
import { parseM3U } from "@/lib/m3u";
import { isValidHttpUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

export async function GET() {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;
  const items = await db
    .select()
    .from(playlists)
    .where(eq(playlists.userId, auth.user.id))
    .orderBy(asc(playlists.createdAt));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;

  let body: { name?: unknown; url?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const inlineContent = typeof body.content === "string" ? body.content : "";
  if (!url && !inlineContent.trim()) {
    return NextResponse.json({ error: "Indica una URL o pega el contenido de la lista" }, { status: 400 });
  }
  if (url && !isValidHttpUrl(url)) {
    return NextResponse.json({ error: "La URL debe empezar por http:// o https://" }, { status: 400 });
  }

  let text = inlineContent;
  if (url) {
    try {
      text = await fetchPlaylistText(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      return NextResponse.json({ error: `No se pudo descargar la lista: ${message}` }, { status: 502 });
    }
  }
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "El contenido supera el tamaño máximo (20 MB)" }, { status: 413 });
  }

  const entries = parseM3U(text);
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No se encontraron canales. ¿Es una lista M3U válida con entradas #EXTINF?" },
      { status: 422 },
    );
  }

  const defaultName = url
    ? (() => {
        try {
          const u = new URL(url);
          return `${u.hostname}${u.pathname}`.slice(0, 80);
        } catch {
          return "Lista importada";
        }
      })()
    : `Lista pegada ${new Date().toLocaleDateString("es-ES")}`;
  const name = (typeof body.name === "string" && body.name.trim()) || defaultName;

  const result = await importEntries(entries, { userId: auth.user.id, name, sourceUrl: url || null, kind: "m3u" });
  return NextResponse.json({ playlist: { id: result.playlistId, name }, ...result }, { status: 201 });
}
