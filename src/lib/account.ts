import { randomBytes, randomInt } from "node:crypto";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { importDemoCatalog } from "@/db/bootstrap";
import { channels, pairings, profiles, providers, users, type Pairing, type User } from "@/db/schema";
import { hashPassword, sha256, verifyPassword, type SafeUser } from "@/lib/auth";
import { syncProvider } from "@/lib/providers";
import { authenticate, normalizeServerUrl, parseExpiry, type XtreamAuthResponse } from "@/lib/xtream";

/** Error whose message is safe to show to the user. */
export class AccountError extends Error {}

export const DEMO_SERVER = "demo";

export interface Credentials {
  serverUrl: string;
  username: string;
  password: string;
}

export const DEMO_CREDENTIALS: Credentials = { serverUrl: DEMO_SERVER, username: "demo", password: "demo" };

export interface ProvisionResult {
  user: SafeUser;
  created: boolean;
  synced: boolean;
  syncError: string | null;
}

function toSafe(u: User): SafeUser {
  return {
    id: u.id,
    serverUrl: u.serverUrl,
    username: u.username,
    name: u.name,
    kind: u.kind,
    role: u.role,
    createdAt: u.createdAt,
  };
}

function hostLabel(serverUrl: string): string {
  try {
    return new URL(serverUrl).hostname;
  } catch {
    return serverUrl;
  }
}

export function isDemoCredentials(creds: Pick<Credentials, "serverUrl">): boolean {
  return creds.serverUrl.trim().toLowerCase() === DEMO_SERVER;
}

async function channelCount(userId: number): Promise<number> {
  const [{ total }] = await db.select({ total: count() }).from(channels).where(eq(channels.userId, userId));
  return total;
}

async function provisionDemo(username: string, password: string): Promise<ProvisionResult> {
  if (username.toLowerCase() !== "demo" || password !== "demo") {
    throw new AccountError("La cuenta de demostración usa usuario «demo» y contraseña «demo»");
  }
  let user = (
    await db
      .select()
      .from(users)
      .where(and(eq(users.serverUrl, DEMO_SERVER), eq(users.username, "demo")))
      .limit(1)
  )[0] as User | undefined;
  let created = false;
  if (!user) {
    const [inserted] = await db
      .insert(users)
      .values({ serverUrl: DEMO_SERVER, username: "demo", passwordHash: hashPassword("demo"), name: "Demo", kind: "demo" })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      user = inserted;
      created = true;
      await db.insert(profiles).values({ userId: inserted.id, name: "Demo", avatar: "📺", color: "#8b5cf6" });
    } else {
      user = (
        await db
          .select()
          .from(users)
          .where(and(eq(users.serverUrl, DEMO_SERVER), eq(users.username, "demo")))
          .limit(1)
      )[0];
    }
  }

  let synced = false;
  let syncError: string | null = null;
  if ((await channelCount(user.id)) === 0) {
    try {
      await importDemoCatalog(user.id);
      synced = true;
    } catch (err) {
      syncError = err instanceof Error ? err.message : String(err);
    }
  }
  return { user: toSafe(user), created, synced, syncError };
}

/**
 * Signs in with provider credentials (Xtream Codes API). Creates the local
 * account, default profile and primary provider on first use and imports the
 * provider catalogue. Later logins are verified locally (so they still work
 * when the provider is slow) unless the password changed.
 */
export async function provisionAccount(input: Credentials): Promise<ProvisionResult> {
  const username = input.username.trim();
  const password = input.password;
  if (isDemoCredentials(input)) return provisionDemo(username, password);

  if (!input.serverUrl.trim()) throw new AccountError("Introduce la URL del servidor");
  if (!username || !password) throw new AccountError("Introduce usuario y contraseña");

  let serverUrl: string;
  try {
    serverUrl = normalizeServerUrl(input.serverUrl);
  } catch {
    throw new AccountError("La URL del servidor no es válida (ejemplo: http://servidor.com:8080)");
  }

  let user = (
    await db
      .select()
      .from(users)
      .where(and(eq(users.serverUrl, serverUrl), eq(users.username, username)))
      .limit(1)
  )[0] as User | undefined;

  let remote: XtreamAuthResponse | null = null;
  if (!user || !verifyPassword(password, user.passwordHash)) {
    try {
      remote = await authenticate({ serverUrl, username, password });
    } catch (err) {
      const message = err instanceof Error ? err.message : "error desconocido";
      throw new AccountError(`No se pudo iniciar sesión: ${message}`);
    }
  }

  let created = false;
  if (!user) {
    const [inserted] = await db
      .insert(users)
      .values({ serverUrl, username, passwordHash: hashPassword(password), name: username, kind: "xtream" })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      user = inserted;
      created = true;
      await db.insert(profiles).values({ userId: inserted.id, name: username, avatar: "😀", color: "#8b5cf6" });
    } else {
      user = (
        await db
          .select()
          .from(users)
          .where(and(eq(users.serverUrl, serverUrl), eq(users.username, username)))
          .limit(1)
      )[0];
    }
  } else if (remote) {
    await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, user.id));
    await db
      .update(providers)
      .set({ password })
      .where(and(eq(providers.userId, user.id), eq(providers.isPrimary, true)));
  }

  let provider = (
    await db
      .select()
      .from(providers)
      .where(and(eq(providers.userId, user.id), eq(providers.isPrimary, true)))
      .limit(1)
  )[0];
  if (!provider) {
    [provider] = await db
      .insert(providers)
      .values({
        userId: user.id,
        name: hostLabel(serverUrl),
        serverUrl,
        username,
        password,
        streamFormat: "m3u8",
        includeVod: false,
        isPrimary: true,
      })
      .returning();
  }
  if (remote?.user_info) {
    const info = remote.user_info;
    await db
      .update(providers)
      .set({
        status: info.status ? String(info.status) : "Active",
        expiresAt: parseExpiry(info.exp_date),
        maxConnections: info.max_connections != null ? Number(info.max_connections) || null : null,
      })
      .where(eq(providers.id, provider.id));
  }

  let synced = false;
  let syncError: string | null = null;
  if (created || (await channelCount(user.id)) === 0) {
    try {
      await syncProvider(provider);
      synced = true;
    } catch (err) {
      syncError = err instanceof Error ? err.message : String(err);
    }
  }

  return { user: toSafe(user), created, synced, syncError };
}

// ───────── QR pairing (TV shows a code, the phone enters the credentials) ─────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
export const PAIRING_TTL_MS = 10 * 60 * 1000;

export function normalizePairingCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export async function createPairing(): Promise<{ code: string; secret: string; expiresAt: Date }> {
  await db.delete(pairings).where(lt(pairings.expiresAt, new Date()));
  const secret = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const [created] = await db
      .insert(pairings)
      .values({ code, secretHash: sha256(secret), expiresAt })
      .onConflictDoNothing()
      .returning({ code: pairings.code });
    if (created) return { code: created.code, secret, expiresAt };
  }
  throw new Error("No se pudo generar un código de emparejamiento");
}

export async function getPairing(rawCode: string): Promise<Pairing | null> {
  const code = normalizePairingCode(rawCode);
  if (code.length !== CODE_LENGTH) return null;
  const [row] = await db
    .select()
    .from(pairings)
    .where(and(eq(pairings.code, code), gt(pairings.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Marks a pending pairing as ready to be claimed by the TV. */
export async function completePairing(rawCode: string, userId: number): Promise<boolean> {
  const code = normalizePairingCode(rawCode);
  const updated = await db
    .update(pairings)
    .set({ status: "ready", userId })
    .where(and(eq(pairings.code, code), eq(pairings.status, "pending"), gt(pairings.expiresAt, new Date())))
    .returning({ id: pairings.id });
  return updated.length > 0;
}

export type ClaimResult =
  | { status: "invalid" | "expired" | "pending" }
  | { status: "ok"; userId: number };

/** Called by the TV with the secret it received when creating the code. */
export async function claimPairing(rawCode: string, secret: string): Promise<ClaimResult> {
  const code = normalizePairingCode(rawCode);
  const [row] = await db.select().from(pairings).where(eq(pairings.code, code)).limit(1);
  if (!row) return { status: "invalid" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "expired" };
  if (sha256(secret) !== row.secretHash) return { status: "invalid" };
  if (row.status === "pending") return { status: "pending" };
  if (row.status === "ready" && row.userId) {
    const claimed = await db
      .update(pairings)
      .set({ status: "claimed" })
      .where(and(eq(pairings.id, row.id), eq(pairings.status, "ready")))
      .returning({ id: pairings.id });
    if (claimed.length === 0) return { status: "invalid" };
    return { status: "ok", userId: row.userId };
  }
  return { status: "invalid" };
}
