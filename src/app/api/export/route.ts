import { NextRequest } from "next/server";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { categories, channels, favorites } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { buildM3U } from "@/lib/m3u";

export const dynamic = "force-dynamic";

/** Exports every active channel (or only favourites) as an M3U playlist. */
export async function GET(req: NextRequest) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const onlyFavorites = req.nextUrl.searchParams.get("favorites") === "1";

  const rows = await db
    .select({
      name: channels.name,
      streamUrl: channels.streamUrl,
      logoUrl: channels.logoUrl,
      tvgId: channels.tvgId,
      group: categories.name,
    })
    .from(channels)
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .leftJoin(favorites, and(eq(favorites.channelId, channels.id), eq(favorites.profileId, auth.profile.id)))
    .where(
      and(
        eq(channels.userId, auth.user.id),
        eq(channels.isActive, true),
        onlyFavorites ? isNotNull(favorites.id) : undefined,
      ),
    )
    .orderBy(asc(channels.channelNumber), asc(channels.name));

  const body = buildM3U(rows.map((r) => ({ ...r, group: r.group ?? "Otros" })));
  return new Response(body, {
    headers: {
      "content-type": "audio/x-mpegurl; charset=utf-8",
      "content-disposition": `attachment; filename="${onlyFavorites ? "favoritos" : "canales"}.m3u"`,
      "cache-control": "no-store",
    },
  });
}
