import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, favorites } from "@/db/schema";
import { apiProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const rows = await db
    .select({ channelId: favorites.channelId })
    .from(favorites)
    .where(eq(favorites.profileId, auth.profile.id));
  return NextResponse.json({ ids: rows.map((r) => r.channelId) });
}

/** Toggles the favourite state of a channel for the active profile. */
export async function POST(req: NextRequest) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  let body: { channelId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const channelId = Number(body.channelId);
  if (!Number.isInteger(channelId) || channelId <= 0) {
    return NextResponse.json({ error: "channelId inválido" }, { status: 400 });
  }

  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.userId, auth.user.id)))
    .limit(1);
  if (!channel) return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });

  const where = and(eq(favorites.channelId, channelId), eq(favorites.profileId, auth.profile.id));
  const [existing] = await db.select().from(favorites).where(where).limit(1);
  if (existing) {
    await db.delete(favorites).where(where);
    return NextResponse.json({ isFavorite: false });
  }
  await db.insert(favorites).values({ channelId, profileId: auth.profile.id }).onConflictDoNothing();
  return NextResponse.json({ isFavorite: true });
}
