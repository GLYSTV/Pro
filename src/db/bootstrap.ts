import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, playlists } from "@/db/schema";
import { seedCategories, seedChannels } from "@/db/seed-data";
import { importEntries, type ImportResult } from "@/lib/import";
import type { M3UEntry } from "@/lib/m3u";

/**
 * Idempotent schema. Besides CREATE TABLE IF NOT EXISTS it also migrates
 * databases created by earlier versions of the app.
 */
const SCHEMA_SQL = `
-- Legacy e-mail based accounts → provider based accounts (URL + user + password).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'server_url') THEN
    DROP TABLE IF EXISTS "pairings" CASCADE;
    DROP TABLE IF EXISTS "recordings" CASCADE;
    DROP TABLE IF EXISTS "watch_history" CASCADE;
    DROP TABLE IF EXISTS "favorites" CASCADE;
    DROP TABLE IF EXISTS "profiles" CASCADE;
    DROP TABLE IF EXISTS "sessions" CASCADE;
    DROP TABLE IF EXISTS "users" CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "server_url" text NOT NULL,
  "username" text NOT NULL,
  "password_hash" text NOT NULL,
  "name" text NOT NULL,
  "kind" varchar(16) DEFAULT 'xtream' NOT NULL,
  "role" varchar(16) DEFAULT 'member' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_server_username_uidx" ON "users" ("server_url","username");
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
CREATE TABLE IF NOT EXISTS "profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "avatar" text DEFAULT '📺' NOT NULL,
  "color" text DEFAULT '#8b5cf6' NOT NULL,
  "is_kids" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "profiles_user_idx" ON "profiles" ("user_id");
CREATE TABLE IF NOT EXISTS "pairings" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "secret_hash" text NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "pairings_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "categories" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "icon" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
CREATE TABLE IF NOT EXISTS "playlists" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "name" text NOT NULL,
  "source_url" text,
  "kind" varchar(16) DEFAULT 'm3u' NOT NULL,
  "channel_count" integer DEFAULT 0 NOT NULL,
  "last_refreshed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "user_id" integer;
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "kind" varchar(16) DEFAULT 'm3u' NOT NULL;
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "last_refreshed_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "playlists_user_idx" ON "playlists" ("user_id");

CREATE TABLE IF NOT EXISTS "epg_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "last_fetched_at" timestamp with time zone,
  "channel_count" integer DEFAULT 0 NOT NULL,
  "program_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "epg_sources" ADD COLUMN IF NOT EXISTS "user_id" integer;

CREATE TABLE IF NOT EXISTS "providers" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "name" text NOT NULL,
  "server_url" text NOT NULL,
  "username" text NOT NULL,
  "password" text NOT NULL,
  "stream_format" varchar(8) DEFAULT 'm3u8' NOT NULL,
  "include_vod" boolean DEFAULT false NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "playlist_id" integer REFERENCES "playlists"("id") ON DELETE SET NULL,
  "epg_source_id" integer REFERENCES "epg_sources"("id") ON DELETE SET NULL,
  "status" text,
  "expires_at" timestamp with time zone,
  "max_connections" integer,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "user_id" integer;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "is_primary" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "channels" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "name" text NOT NULL,
  "stream_url" text NOT NULL,
  "logo_url" text,
  "category_id" integer,
  "playlist_id" integer,
  "tvg_id" text,
  "group_title" text,
  "country" varchar(8),
  "language" varchar(16),
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "channel_number" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "channels_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE set null,
  CONSTRAINT "channels_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE cascade
);
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "user_id" integer;
CREATE INDEX IF NOT EXISTS "channels_user_idx" ON "channels" ("user_id");
CREATE INDEX IF NOT EXISTS "channels_category_idx" ON "channels" ("category_id");
CREATE INDEX IF NOT EXISTS "channels_playlist_idx" ON "channels" ("playlist_id");
CREATE INDEX IF NOT EXISTS "channels_name_idx" ON "channels" ("name");

-- Owner foreign keys (added separately so they survive the users table being recreated).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'playlists_user_id_fkey') THEN
    ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'epg_sources_user_id_fkey') THEN
    ALTER TABLE "epg_sources" ADD CONSTRAINT "epg_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_user_id_fkey') THEN
    ALTER TABLE "providers" ADD CONSTRAINT "providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channels_user_id_fkey') THEN
    ALTER TABLE "channels" ADD CONSTRAINT "channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Catalogue rows are always owned by an account now; drop legacy global rows.
DELETE FROM "channels" WHERE "user_id" IS NULL;
DELETE FROM "playlists" WHERE "user_id" IS NULL;
DELETE FROM "epg_sources" WHERE "user_id" IS NULL;
DELETE FROM "providers" WHERE "user_id" IS NULL;

CREATE TABLE IF NOT EXISTS "favorites" (
  "id" serial PRIMARY KEY NOT NULL,
  "profile_id" integer NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "channel_id" integer NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_profile_channel_uidx" ON "favorites" ("profile_id","channel_id");
CREATE TABLE IF NOT EXISTS "watch_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "profile_id" integer NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "channel_id" integer NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "watched_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "watch_history_profile_idx" ON "watch_history" ("profile_id","watched_at");

CREATE TABLE IF NOT EXISTS "programs" (
  "id" serial PRIMARY KEY NOT NULL,
  "channel_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "genre" text,
  "start_time" timestamp with time zone NOT NULL,
  "end_time" timestamp with time zone NOT NULL,
  "source" varchar(16) DEFAULT 'generated' NOT NULL,
  "epg_source_id" integer REFERENCES "epg_sources"("id") ON DELETE CASCADE,
  CONSTRAINT "programs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE cascade
);
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "source" varchar(16) DEFAULT 'generated' NOT NULL;
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "epg_source_id" integer REFERENCES "epg_sources"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "programs_channel_start_idx" ON "programs" ("channel_id","start_time");

CREATE TABLE IF NOT EXISTS "recordings" (
  "id" serial PRIMARY KEY NOT NULL,
  "profile_id" integer NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "channel_id" integer REFERENCES "channels"("id") ON DELETE SET NULL,
  "channel_name" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "stream_url" text NOT NULL,
  "start_time" timestamp with time zone NOT NULL,
  "end_time" timestamp with time zone NOT NULL,
  "status" varchar(16) DEFAULT 'scheduled' NOT NULL,
  "container" varchar(8) DEFAULT 'ts' NOT NULL,
  "segment_count" integer DEFAULT 0 NOT NULL,
  "size_bytes" bigint DEFAULT 0 NOT NULL,
  "duration_seconds" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "recordings_profile_idx" ON "recordings" ("profile_id","start_time");
CREATE INDEX IF NOT EXISTS "recordings_status_idx" ON "recordings" ("status","start_time");
`;

async function ensureSchema() {
  await db.execute(sql.raw(SCHEMA_SQL));
}

/** Inserts the built-in categories that are missing (shared by all accounts). */
export async function ensureSeedCategories(): Promise<Map<string, { id: number; name: string }>> {
  const existing = await db.select().from(categories);
  const bySlug = new Map(existing.map((c) => [c.slug, { id: c.id, name: c.name }]));
  for (const cat of seedCategories) {
    if (bySlug.has(cat.slug)) continue;
    const [inserted] = await db
      .insert(categories)
      .values({ name: cat.name, slug: cat.slug, icon: cat.icon, sortOrder: cat.sortOrder })
      .onConflictDoNothing()
      .returning();
    if (inserted) bySlug.set(inserted.slug, { id: inserted.id, name: inserted.name });
  }
  return bySlug;
}

export const DEMO_PLAYLIST_NAME = "Canales de demostración";

/**
 * Adds (or refreshes) the built-in demo channels in the given account's
 * catalogue. Existing demo channels are updated in place so favourites and
 * recordings keep working.
 */
export async function importDemoCatalog(userId: number): Promise<ImportResult> {
  const cats = await ensureSeedCategories();
  const entries: M3UEntry[] = seedChannels.map((c) => ({
    name: c.name,
    url: c.streamUrl,
    logo: c.logoUrl ?? undefined,
    group: cats.get(c.category)?.name ?? c.category,
    country: c.country ?? undefined,
    language: c.language ?? undefined,
    description: c.description,
  }));
  const [existing] = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.userId, userId), eq(playlists.kind, "demo")))
    .limit(1);
  return importEntries(entries, {
    userId,
    name: DEMO_PLAYLIST_NAME,
    sourceUrl: null,
    kind: "demo",
    playlistId: existing?.id,
  });
}

const globalForBootstrap = globalThis as typeof globalThis & {
  __iptvBootstrapPromise?: Promise<void>;
};

/**
 * Makes sure the schema and built-in categories exist. Memoised per process so
 * it only runs real work once; failures reset the memo so the next request retries.
 */
export function bootstrap(): Promise<void> {
  if (!globalForBootstrap.__iptvBootstrapPromise) {
    globalForBootstrap.__iptvBootstrapPromise = (async () => {
      await ensureSchema();
      await ensureSeedCategories();
    })().catch((err) => {
      globalForBootstrap.__iptvBootstrapPromise = undefined;
      throw err;
    });
  }
  return globalForBootstrap.__iptvBootstrapPromise;
}
