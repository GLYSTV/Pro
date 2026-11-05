import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { apiProfile, apiUser } from "@/lib/auth";
import { maskProvider, syncProvider } from "@/lib/providers";
import { importEpgSource } from "@/lib/xmltv";
import { normalizeServerUrl } from "@/lib/xtream";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;
  const items = await db
    .select()
    .from(providers)
    .where(eq(providers.userId, auth.user.id))
    .orderBy(asc(providers.createdAt));
  return NextResponse.json({ items: items.map(maskProvider) });
}

/** Registers an Xtream Codes provider and imports its live catalogue. */
export async function POST(req: NextRequest) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "").trim();
  let serverUrl: string;
  try {
    serverUrl = normalizeServerUrl(String(body.serverUrl ?? ""));
  } catch {
    return NextResponse.json({ error: "La URL del servidor no es válida" }, { status: 400 });
  }
  if (!username || !password) {
    return NextResponse.json({ error: "Usuario y contraseña son obligatorios" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim() || new URL(serverUrl).hostname;
  const streamFormat = body.streamFormat === "ts" ? "ts" : "m3u8";
  const includeVod = Boolean(body.includeVod);

  const [provider] = await db
    .insert(providers)
    .values({ userId: auth.user.id, name, serverUrl, username, password, streamFormat, includeVod, isPrimary: false })
    .returning();

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
    return NextResponse.json({ ...result, provider: maskProvider(result.provider) }, { status: 201 });
  } catch (err) {
    // Roll back the provider row when the very first sync fails.
    await db.delete(providers).where(eq(providers.id, provider.id));
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `No se pudo conectar con el proveedor: ${message}` }, { status: 502 });
  }
}
