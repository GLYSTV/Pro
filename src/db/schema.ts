import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ───────── Cuentas (acceso con URL + usuario + contraseña) ─────────

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    /** Normalised provider URL, or "demo" for the built-in demo account. */
    serverUrl: text("server_url").notNull(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    kind: varchar("kind", { length: 16 }).default("xtream").notNull(),
    role: varchar("role", { length: 16 }).default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_server_username_uidx").on(t.serverUrl, t.username)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const profiles = pgTable(
  "profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    avatar: text("avatar").default("📺").notNull(),
    color: text("color").default("#8b5cf6").notNull(),
    isKids: boolean("is_kids").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("profiles_user_idx").on(t.userId)],
);

/** QR pairing codes: the TV shows a code, the phone submits the credentials. */
export const pairings = pgTable("pairings", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  status: varchar("status", { length: 16 }).default("pending").notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ───────── Catálogo (por cuenta) ─────────

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  icon: text("icon"),
  sortOrder: integer("sort_order").default(0).notNull(),
});

export const playlists = pgTable(
  "playlists",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceUrl: text("source_url"),
    kind: varchar("kind", { length: 16 }).default("m3u").notNull(),
    channelCount: integer("channel_count").default(0).notNull(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("playlists_user_idx").on(t.userId)],
);

export const epgSources = pgTable("epg_sources", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  channelCount: integer("channel_count").default(0).notNull(),
  programCount: integer("program_count").default(0).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  serverUrl: text("server_url").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  streamFormat: varchar("stream_format", { length: 8 }).default("m3u8").notNull(),
  includeVod: boolean("include_vod").default(false).notNull(),
  /** The provider used to sign in (cannot be removed). */
  isPrimary: boolean("is_primary").default(false).notNull(),
  playlistId: integer("playlist_id").references(() => playlists.id, { onDelete: "set null" }),
  epgSourceId: integer("epg_source_id").references(() => epgSources.id, { onDelete: "set null" }),
  status: text("status"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxConnections: integer("max_connections"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const channels = pgTable(
  "channels",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    streamUrl: text("stream_url").notNull(),
    logoUrl: text("logo_url"),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    playlistId: integer("playlist_id").references(() => playlists.id, {
      onDelete: "cascade",
    }),
    tvgId: text("tvg_id"),
    groupTitle: text("group_title"),
    country: varchar("country", { length: 8 }),
    language: varchar("language", { length: 16 }),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    channelNumber: integer("channel_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("channels_user_idx").on(t.userId),
    index("channels_category_idx").on(t.categoryId),
    index("channels_playlist_idx").on(t.playlistId),
    index("channels_name_idx").on(t.name),
  ],
);

// ───────── Datos por perfil ─────────

export const favorites = pgTable(
  "favorites",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("favorites_profile_channel_uidx").on(t.profileId, t.channelId)],
);

export const watchHistory = pgTable(
  "watch_history",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    watchedAt: timestamp("watched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("watch_history_profile_idx").on(t.profileId, t.watchedAt)],
);

// ───────── Guía de programación ─────────

export const programs = pgTable(
  "programs",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    genre: text("genre"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    source: varchar("source", { length: 16 }).default("generated").notNull(),
    epgSourceId: integer("epg_source_id").references(() => epgSources.id, { onDelete: "cascade" }),
  },
  (t) => [index("programs_channel_start_idx").on(t.channelId, t.startTime)],
);

// ───────── Grabaciones (DVR) ─────────

export const recordings = pgTable(
  "recordings",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    channelName: text("channel_name").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    streamUrl: text("stream_url").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 16 }).default("scheduled").notNull(),
    container: varchar("container", { length: 8 }).default("ts").notNull(),
    segmentCount: integer("segment_count").default(0).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).default(0).notNull(),
    durationSeconds: integer("duration_seconds").default(0).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("recordings_profile_idx").on(t.profileId, t.startTime),
    index("recordings_status_idx").on(t.status, t.startTime),
  ],
);

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Pairing = typeof pairings.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Playlist = typeof playlists.$inferSelect;
export type Program = typeof programs.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type EpgSource = typeof epgSources.$inferSelect;
export type Recording = typeof recordings.$inferSelect;
