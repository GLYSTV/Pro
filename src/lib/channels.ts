import { and, asc, count, countDistinct, desc, eq, ilike, isNotNull, max, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { categories, channels, favorites, playlists, watchHistory } from "@/db/schema";

export const KIDS_CATEGORY_SLUG = "infantil";

export interface ChannelListItem {
  id: number;
  name: string;
  streamUrl: string;
  logoUrl: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categorySlug: string | null;
  categoryIcon: string | null;
  playlistId: number | null;
  country: string | null;
  language: string | null;
  description: string | null;
  groupTitle: string | null;
  tvgId: string | null;
  isActive: boolean;
  channelNumber: number | null;
  isFavorite: boolean;
}

export interface ChannelFilters {
  /** Account that owns the catalogue. */
  userId: number;
  /** Profile used to resolve favourites. */
  profileId: number;
  q?: string;
  categorySlug?: string;
  playlistId?: number;
  number?: number;
  onlyFavorites?: boolean;
  includeInactive?: boolean;
  /** Restrict to the kids category (child profiles). */
  kidsOnly?: boolean;
  page?: number;
  limit?: number;
}

const selection = {
  id: channels.id,
  name: channels.name,
  streamUrl: channels.streamUrl,
  logoUrl: channels.logoUrl,
  categoryId: channels.categoryId,
  categoryName: categories.name,
  categorySlug: categories.slug,
  categoryIcon: categories.icon,
  playlistId: channels.playlistId,
  country: channels.country,
  language: channels.language,
  description: channels.description,
  groupTitle: channels.groupTitle,
  tvgId: channels.tvgId,
  isActive: channels.isActive,
  channelNumber: channels.channelNumber,
  favoriteId: favorites.id,
};

type Row = {
  [K in keyof typeof selection]: K extends "favoriteId"
    ? number | null
    : ChannelListItem[Extract<K, keyof ChannelListItem>];
};

function toItem(row: Row): ChannelListItem {
  const { favoriteId, ...rest } = row;
  return { ...rest, isFavorite: favoriteId != null };
}

const favoriteJoin = (profileId: number) =>
  and(eq(favorites.channelId, channels.id), eq(favorites.profileId, profileId));

function buildWhere(f: ChannelFilters): SQL | undefined {
  const conditions: SQL[] = [eq(channels.userId, f.userId)];
  if (!f.includeInactive) conditions.push(eq(channels.isActive, true));
  if (f.q && f.q.trim()) conditions.push(ilike(channels.name, `%${f.q.trim()}%`));
  if (f.categorySlug) conditions.push(eq(categories.slug, f.categorySlug));
  if (f.kidsOnly) conditions.push(eq(categories.slug, KIDS_CATEGORY_SLUG));
  if (f.playlistId) conditions.push(eq(channels.playlistId, f.playlistId));
  if (f.number != null) conditions.push(eq(channels.channelNumber, f.number));
  if (f.onlyFavorites) conditions.push(isNotNull(favorites.id));
  return and(...conditions);
}

export async function listChannels(filters: ChannelFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 48));
  const where = buildWhere(filters);

  const rows = await db
    .select(selection)
    .from(channels)
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .leftJoin(favorites, favoriteJoin(filters.profileId))
    .where(where)
    .orderBy(
      filters.onlyFavorites ? desc(favorites.createdAt) : asc(channels.channelNumber),
      asc(channels.name),
      asc(channels.id),
    )
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ total }] = await db
    .select({ total: count() })
    .from(channels)
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .leftJoin(favorites, favoriteJoin(filters.profileId))
    .where(where);

  return {
    items: rows.map(toItem),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getChannel(id: number, userId: number, profileId: number): Promise<ChannelListItem | null> {
  const rows = await db
    .select(selection)
    .from(channels)
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .leftJoin(favorites, favoriteJoin(profileId))
    .where(and(eq(channels.id, id), eq(channels.userId, userId)))
    .limit(1);
  return rows[0] ? toItem(rows[0]) : null;
}

/** Channels used for zapping (same category as the current channel, or all). */
export async function getZapList(
  userId: number,
  categoryId: number | null,
  profileId: number,
  kidsOnly = false,
  limit = 300,
) {
  const rows = await db
    .select(selection)
    .from(channels)
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .leftJoin(favorites, favoriteJoin(profileId))
    .where(
      and(
        eq(channels.userId, userId),
        eq(channels.isActive, true),
        categoryId == null ? undefined : eq(channels.categoryId, categoryId),
        kidsOnly ? eq(categories.slug, KIDS_CATEGORY_SLUG) : undefined,
      ),
    )
    .orderBy(asc(channels.channelNumber), asc(channels.name), asc(channels.id))
    .limit(limit);
  return rows.map(toItem);
}

export async function listCategoriesWithCounts(userId: number) {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      icon: categories.icon,
      sortOrder: categories.sortOrder,
      channelCount: sql<number>`count(${channels.id}) filter (where ${channels.isActive} = true and ${channels.userId} = ${userId})::int`,
    })
    .from(categories)
    .leftJoin(channels, eq(channels.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows;
}

export async function getRecentlyWatched(userId: number, profileId: number, limit = 12, kidsOnly = false) {
  const recent = await db
    .select({ channelId: watchHistory.channelId, lastWatched: max(watchHistory.watchedAt) })
    .from(watchHistory)
    .where(eq(watchHistory.profileId, profileId))
    .groupBy(watchHistory.channelId)
    .orderBy(desc(max(watchHistory.watchedAt)))
    .limit(limit);
  if (recent.length === 0) return [] as Array<ChannelListItem & { lastWatched: Date | null }>;

  const ids = recent.map((r) => r.channelId);
  const rows = await db
    .select(selection)
    .from(channels)
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .leftJoin(favorites, favoriteJoin(profileId))
    .where(
      and(
        eq(channels.userId, userId),
        eq(channels.isActive, true),
        sql`${channels.id} in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`,
        kidsOnly ? eq(categories.slug, KIDS_CATEGORY_SLUG) : undefined,
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, toItem(r)]));
  return recent
    .map((r) => {
      const item = byId.get(r.channelId);
      return item ? { ...item, lastWatched: r.lastWatched } : null;
    })
    .filter((x): x is ChannelListItem & { lastWatched: Date | null } => x !== null);
}

export async function getStats(userId: number, profileId: number) {
  const [{ totalChannels, totalCategories }] = await db
    .select({ totalChannels: count(), totalCategories: countDistinct(channels.categoryId) })
    .from(channels)
    .where(and(eq(channels.userId, userId), eq(channels.isActive, true)));
  const [{ totalFavorites }] = await db
    .select({ totalFavorites: count() })
    .from(favorites)
    .where(eq(favorites.profileId, profileId));
  const [{ totalPlaylists }] = await db
    .select({ totalPlaylists: count() })
    .from(playlists)
    .where(eq(playlists.userId, userId));
  return { totalChannels, totalFavorites, totalPlaylists, totalCategories };
}
