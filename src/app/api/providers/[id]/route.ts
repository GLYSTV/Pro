import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { epgSources, playlists, providers } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { pruneEmptyCustomCategories } from "@/lib/import";
import { maskProvider, syncProvider } from "@/lib/providers";
import { importEpgSource } from "@/lib/xmltv";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(raw: string, userId: number) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [provider] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.userId, userId)))
    .limit(1);
  return provider ?? null;
}

/** Re-synchronises the provider catalogue (and refreshes its EPG in the background). */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const provider = await load((await params).id, auth.user.id);
  if (!provider) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  try {
    const result = await syncProvider(provider);
    const epgId = result.epgSourceId;
    if (epgId) {
      after(async () => {
        try {
          await importEpgSource(epgId);
        } catch (err) {
          console.error("[providers] EPG import failed", err);
        }
      });
    }
    return NextResponse.json({ ...result, provider: maskProvider(result.provider) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `Sincronización fallida: ${message}` }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const provider = await load((await params).id, auth.user.id);
  if (!provider) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  if (provider.isPrimary) {
    return NextResponse.json(
      { error: "No puedes eliminar el proveedor con el que iniciaste sesión" },
      { status: 400 },
    );
  }

  if (provider.playlistId) await db.delete(playlists).where(eq(playlists.id, provider.playlistId));
  if (provider.epgSourceId) await db.delete(epgSources).where(eq(epgSources.id, provider.epgSourceId));
  await db.delete(providers).where(eq(providers.id, provider.id));
  await pruneEmptyCustomCategories();
  return NextResponse.json({ ok: true });
}
