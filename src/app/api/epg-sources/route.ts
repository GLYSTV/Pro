import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { epgSources } from "@/db/schema";
import { apiProfile, apiUser } from "@/lib/auth";
import { isValidHttpUrl } from "@/lib/utils";
import { importEpgSource } from "@/lib/xmltv";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;
  const items = await db
    .select()
    .from(epgSources)
    .where(eq(epgSources.userId, auth.user.id))
    .orderBy(asc(epgSources.createdAt));
  return NextResponse.json({ items });
}

/** Adds an XMLTV source and imports it immediately. */
export async function POST(req: NextRequest) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  let body: { name?: unknown; url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const url = String(body.url ?? "").trim();
  if (!isValidHttpUrl(url)) return NextResponse.json({ error: "La URL debe empezar por http:// o https://" }, { status: 400 });
  const name = String(body.name ?? "").trim() || new URL(url).hostname;

  const [source] = await db.insert(epgSources).values({ userId: auth.user.id, name, url }).returning();
  try {
    const result = await importEpgSource(source.id);
    return NextResponse.json({ source: { ...source, ...result }, ...result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      { error: `La fuente se guardó pero la importación falló: ${message}`, sourceId: source.id },
      { status: 502 },
    );
  }
}
