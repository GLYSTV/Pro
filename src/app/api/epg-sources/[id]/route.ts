import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { epgSources } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { importEpgSource } from "@/lib/xmltv";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function loadOwned(raw: string, userId: number) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [source] = await db
    .select({ id: epgSources.id })
    .from(epgSources)
    .where(and(eq(epgSources.id, id), eq(epgSources.userId, userId)))
    .limit(1);
  return source ?? null;
}

/** Re-imports the XMLTV source. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const source = await loadOwned((await params).id, auth.user.id);
  if (!source) return NextResponse.json({ error: "Fuente no encontrada" }, { status: 404 });
  try {
    const result = await importEpgSource(source.id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `Importación fallida: ${message}` }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const source = await loadOwned((await params).id, auth.user.id);
  if (!source) return NextResponse.json({ error: "Fuente no encontrada" }, { status: 404 });
  // programs imported from this source cascade-delete
  await db.delete(epgSources).where(eq(epgSources.id, source.id));
  return NextResponse.json({ ok: true });
}
