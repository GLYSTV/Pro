import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, channels, playlists } from "@/db/schema";
import { mapGroupToSlug, type M3UEntry } from "@/lib/m3u";
import { isValidHttpUrl, slugify } from "@/lib/utils";

export const MAX_CHANNELS_PER_PLAYLIST = 8000;

export interface ImportOptions {
  /** Account that owns the imported channels. */
  userId: number;
  name: string;
  sourceUrl: string | null;
  kind: "m3u" | "xtream" | "demo";
  /** When provided the playlist is refreshed in place (upsert by stream URL). */
  playlistId?: number;
}

export interface ImportResult {
  playlistId: number;
  name: string;
  parsed: number;
  imported: number;
  updated: number;
  removed: number;
  duplicates: number;
  truncated: boolean;
}

/** Resolves (and lazily creates) categories for playlist group titles. */
async function createCategoryResolver() {
  const existing = await db.select().from(categories);
  const bySlug = new Map(existing.map((c) => [c.slug, c.id]));
  let nextSort = existing.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1;
  const cache = new Map<string, number | null>();

  return async function resolve(group: string | undefined): Promise<number | null> {
    const key = group ?? "";
    if (cache.has(key)) return cache.get(key) ?? null;

    let result: number | null = null;
    if (!group) {
      result = bySlug.get("generalista") ?? null;
    } else {
      const mapped = mapGroupToSlug(group);
      if (mapped && bySlug.has(mapped)) {
        result = bySlug.get(mapped)!;
      } else {
        const slug = slugify(group);
        if (bySlug.has(slug)) {
          result = bySlug.get(slug)!;
        } else {
          const [created] = await db
            .insert(categories)
            .values({ name: group.slice(0, 60), slug, icon: "Folder", sortOrder: nextSort++ })
            .onConflictDoNothing()
            .returning();
          if (created) {
            bySlug.set(slug, created.id);
            result = created.id;
          } else {
            const [found] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
            if (found) bySlug.set(slug, found.id);
            result = found?.id ?? null;
          }
        }
      }
    }
    cache.set(key, result);
    return result;
  };
}

/**
 * Imports parsed playlist entries into the catalogue. When `playlistId` is
 * given, existing channels are updated in place (matched by stream URL) so
 * favourites, history and recordings keep pointing to the same rows.
 */
export async function importEntries(entries: M3UEntry[], options: ImportOptions): Promise<ImportResult> {
  const truncated = entries.length > MAX_CHANNELS_PER_PLAYLIST;
  const selected = entries.slice(0, MAX_CHANNELS_PER_PLAYLIST);

  const seen = new Set<string>();
  const unique = selected.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });

  const resolveCategory = await createCategoryResolver();

  let playlistId = options.playlistId ?? null;
  if (playlistId) {
    const [existing] = await db
      .select()
      .from(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, options.userId)))
      .limit(1);
    if (!existing) playlistId = null;
  }
  if (!playlistId) {
    const [created] = await db
      .insert(playlists)
      .values({
        userId: options.userId,
        name: options.name,
        sourceUrl: options.sourceUrl,
        kind: options.kind,
        channelCount: 0,
      })
      .returning();
    playlistId = created.id;
  }

  const existingRows = await db
    .select({ id: channels.id, streamUrl: channels.streamUrl })
    .from(channels)
    .where(eq(channels.playlistId, playlistId));
  const existingByUrl = new Map(existingRows.map((r) => [r.streamUrl, r.id]));

  const [{ maxNumber }] = await db
    .select({ maxNumber: sql<number>`coalesce(max(${channels.channelNumber}), 0)::int` })
    .from(channels)
    .where(eq(channels.userId, options.userId));
  let number = maxNumber;

  const inserts: Array<typeof channels.$inferInsert> = [];
  let updated = 0;
  const keep = new Set<number>();

  for (const e of unique) {
    const categoryId = await resolveCategory(e.group);
    const base = {
      name: e.name.slice(0, 200),
      logoUrl: e.logo && isValidHttpUrl(e.logo) ? e.logo : null,
      categoryId,
      tvgId: e.tvgId ?? null,
      groupTitle: e.group ?? null,
      country: e.country ? e.country.slice(0, 8).toUpperCase() : null,
      language: e.language ? e.language.slice(0, 16).toLowerCase() : null,
      ...(e.description !== undefined ? { description: e.description } : {}),
    };
    const existingId = existingByUrl.get(e.url);
    if (existingId) {
      keep.add(existingId);
      await db.update(channels).set(base).where(eq(channels.id, existingId));
      updated++;
    } else {
      inserts.push({
        ...base,
        userId: options.userId,
        streamUrl: e.url,
        playlistId,
        isActive: true,
        channelNumber: ++number,
      });
    }
  }

  for (let i = 0; i < inserts.length; i += 500) {
    await db.insert(channels).values(inserts.slice(i, i + 500));
  }

  const toRemove = existingRows.filter((r) => !keep.has(r.id)).map((r) => r.id);
  for (let i = 0; i < toRemove.length; i += 500) {
    await db.delete(channels).where(inArray(channels.id, toRemove.slice(i, i + 500)));
  }

  const total = unique.length;
  await db
    .update(playlists)
    .set({
      channelCount: total,
      lastRefreshedAt: new Date(),
      ...(options.playlistId ? {} : { name: options.name }),
    })
    .where(eq(playlists.id, playlistId));

  return {
    playlistId,
    name: options.name,
    parsed: entries.length,
    imported: inserts.length,
    updated,
    removed: toRemove.length,
    duplicates: selected.length - unique.length,
    truncated,
  };
}

const MAX_BYTES = 20 * 1024 * 1024;

/** Downloads a remote playlist with a size cap. */
export async function fetchPlaylistText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GLYSTV-PRO/1.0)", Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error("La lista supera el tamaño máximo (20 MB)");

  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      reader.cancel().catch(() => undefined);
      throw new Error("La lista supera el tamaño máximo (20 MB)");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

/** Removes auto-created (Folder) categories that no longer hold channels. */
export async function pruneEmptyCustomCategories() {
  await db.execute(sql`
    delete from categories
    where icon = 'Folder'
      and id not in (select category_id from channels where category_id is not null)
  `);
}
