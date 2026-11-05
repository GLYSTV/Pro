import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { bootstrap } from "@/db/bootstrap";
import { profiles, sessions, users, type Profile, type User } from "@/db/schema";

export const SESSION_COOKIE = "glystv_session";
export const PROFILE_COOKIE = "glystv_profile";
const SESSION_DAYS = 30;

export type SafeUser = Omit<User, "passwordHash">;

export interface AuthContext {
  user: SafeUser | null;
  profile: Profile | null;
  profiles: Profile[];
}

// ───────── Passwords ─────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function cookieSecure(): Promise<boolean> {
  try {
    const proto = (await headers()).get("x-forwarded-proto");
    if (proto) return proto.split(",")[0].trim() === "https";
  } catch {
    // headers() unavailable (e.g. during static generation)
  }
  return false;
}

// ───────── Sessions ─────────

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    expires: expiresAt,
  });
}

export async function setActiveProfileCookie(profileId: number) {
  const jar = await cookies();
  jar.set(PROFILE_COOKIE, String(profileId), {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearActiveProfileCookie() {
  const jar = await cookies();
  jar.delete(PROFILE_COOKIE);
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(PROFILE_COOKIE);
}

/**
 * Creates a session and picks the profile automatically when the account only
 * has one. Returns the path the client should navigate to next.
 */
export async function startSessionFor(userId: number): Promise<string> {
  await createSession(userId);
  const userProfiles = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .orderBy(asc(profiles.id));
  if (userProfiles.length === 1) {
    await setActiveProfileCookie(userProfiles[0].id);
    return "/";
  }
  return "/profiles";
}

/** Resolves the current user + active profile from cookies (memoised per request). */
export const getAuth = cache(async (): Promise<AuthContext> => {
  await bootstrap();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return { user: null, profile: null, profiles: [] };

  const [row] = await db
    .select({
      id: users.id,
      serverUrl: users.serverUrl,
      username: users.username,
      name: users.name,
      kind: users.kind,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return { user: null, profile: null, profiles: [] };

  const userProfiles = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, row.id))
    .orderBy(asc(profiles.id));
  const activeId = Number(jar.get(PROFILE_COOKIE)?.value);
  const profile = userProfiles.find((p) => p.id === activeId) ?? null;

  return { user: row, profile, profiles: userProfiles };
});

// ───────── Guards for server components ─────────

export type UserContext = AuthContext & { user: SafeUser };
export type ProfileContext = AuthContext & { user: SafeUser; profile: Profile };

export async function requireUser(): Promise<UserContext> {
  const auth = await getAuth();
  if (!auth.user) redirect("/login");
  return auth as UserContext;
}

export async function requireProfile(): Promise<ProfileContext> {
  const auth = await requireUser();
  if (!auth.profile) redirect("/profiles");
  return auth as ProfileContext;
}

// ───────── Guards for route handlers ─────────

type Denied = { ok: false; response: Response };

export async function apiUser(): Promise<
  { ok: true; user: SafeUser; profile: Profile | null; profiles: Profile[] } | Denied
> {
  const auth = await getAuth();
  if (!auth.user) {
    return { ok: false, response: Response.json({ error: "Inicia sesión para continuar" }, { status: 401 }) };
  }
  return { ok: true, user: auth.user, profile: auth.profile, profiles: auth.profiles };
}

export async function apiProfile(): Promise<
  { ok: true; user: SafeUser; profile: Profile; profiles: Profile[] } | Denied
> {
  const result = await apiUser();
  if (!result.ok) return result;
  if (!result.profile) {
    return { ok: false, response: Response.json({ error: "Selecciona un perfil" }, { status: 403 }) };
  }
  return { ok: true, user: result.user, profile: result.profile, profiles: result.profiles };
}

/** Human readable label for the account's provider host. */
export function accountHost(user: Pick<SafeUser, "serverUrl" | "kind">): string {
  if (user.kind === "demo") return "Cuenta de demostración";
  try {
    return new URL(user.serverUrl).host;
  } catch {
    return user.serverUrl;
  }
}
