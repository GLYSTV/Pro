import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, channels } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { listChannels } from "@/lib/channels";
import { isValidHttpUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;

  const result = await listChannels({
    userId: auth.user.id,
    profileId: auth.profile.id,
    kidsOnly: auth.profile.isKids,
    q: sp.get("q") ?? undefined,
    categorySlug: sp.get("category") ?? undefined,
    playlistId: sp.get("playlist") ? Number(sp.get("playlist")) : undefined,
    number: sp.get("number") ? Number(sp.get("number")) : undefined,
    onlyFavorites: sp.get("favorites") === "1",
    includeInactive: sp.get("all") === "1",
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 48,
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const streamUrl = String(body.streamUrl ?? "").trim();
  if (!name) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
  if (!isValidHttpUrl(streamUrl)) {
    return NextResponse.json({ error: "La URL del stream debe ser http(s) válida" }, { status: 400 });
  }

  let categoryId: number | null = null;
  if (body.categoryId != null && body.categoryId !== "") {
    categoryId = Number(body.categoryId);
    const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
    if (!cat) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 400 });
  }

  const [{ maxNumber }] = await db
    .select({ maxNumber: sql<number>`coalesce(max(${channels.channelNumber}), 0)::int` })
    .from(channels)
    .where(eq(channels.userId, auth.user.id));

  const logoUrl = String(body.logoUrl ?? "").trim();
  const [created] = await db
    .insert(channels)
    .values({
      userId: auth.user.id,
      name,
      streamUrl,
      logoUrl: logoUrl && isValidHttpUrl(logoUrl) ? logoUrl : null,
      categoryId,
      tvgId: body.tvgId ? String(body.tvgId).trim() : null,
      country: body.country ? String(body.country).trim().toUpperCase().slice(0, 8) : null,
      language: body.language ? String(body.language).trim().toLowerCase().slice(0, 16) : null,
      description: body.description ? String(body.description).trim() : null,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      channelNumber: maxNumber + 1,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
