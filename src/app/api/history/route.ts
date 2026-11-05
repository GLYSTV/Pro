import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { channels, watchHistory } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { getRecentlyWatched } from "@/lib/channels";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const items = await getRecentlyWatched(auth.user.id, auth.profile.id, 20, auth.profile.isKids);
  return NextResponse.json({ items });
}

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

  const profileId = auth.profile.id;
  await db.insert(watchHistory).values({ channelId, profileId });
  // keep the table small: retain the 500 most recent rows per profile
  await db.execute(sql`
    delete from watch_history
    where profile_id = ${profileId} and id in (
      select id from watch_history where profile_id = ${profileId} order by watched_at desc offset 500
    )
  `);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  await db.delete(watchHistory).where(eq(watchHistory.profileId, auth.profile.id));
  return NextResponse.json({ ok: true });
}
