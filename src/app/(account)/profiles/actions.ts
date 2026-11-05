"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { clearActiveProfileCookie, getAuth, requireUser, setActiveProfileCookie } from "@/lib/auth";
import { AVATARS, COLORS, MAX_PROFILES } from "@/lib/profile-options";

export interface ProfileFormState {
  error?: string;
  ok?: boolean;
}


export async function selectProfileAction(formData: FormData) {
  const { user } = await requireUser();
  const id = Number(formData.get("profileId"));
  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, id), eq(profiles.userId, user.id)))
    .limit(1);
  if (!profile) redirect("/profiles");
  await setActiveProfileCookie(profile.id);
  redirect("/");
}

export async function createProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const { user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const avatar = String(formData.get("avatar") ?? AVATARS[0]);
  const color = String(formData.get("color") ?? COLORS[0]);
  const isKids = formData.get("isKids") === "on";
  if (name.length < 1 || name.length > 30) return { error: "El nombre debe tener entre 1 y 30 caracteres" };
  const [{ total }] = await db.select({ total: count() }).from(profiles).where(eq(profiles.userId, user.id));
  if (total >= MAX_PROFILES) return { error: `Máximo ${MAX_PROFILES} perfiles por cuenta` };

  const [profile] = await db
    .insert(profiles)
    .values({
      userId: user.id,
      name,
      avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
      color: COLORS.includes(color) ? color : COLORS[0],
      isKids,
    })
    .returning();
  await setActiveProfileCookie(profile.id);
  redirect("/");
}

export async function updateProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const { user } = await requireUser();
  const id = Number(formData.get("profileId"));
  const name = String(formData.get("name") ?? "").trim();
  const avatar = String(formData.get("avatar") ?? AVATARS[0]);
  const color = String(formData.get("color") ?? COLORS[0]);
  const isKids = formData.get("isKids") === "on";
  if (name.length < 1 || name.length > 30) return { error: "El nombre debe tener entre 1 y 30 caracteres" };
  const [updated] = await db
    .update(profiles)
    .set({
      name,
      avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
      color: COLORS.includes(color) ? color : COLORS[0],
      isKids,
    })
    .where(and(eq(profiles.id, id), eq(profiles.userId, user.id)))
    .returning();
  if (!updated) return { error: "Perfil no encontrado" };
  revalidatePath("/profiles");
  return { ok: true };
}

export async function deleteProfileAction(formData: FormData) {
  const { user, profile: active } = await getAuth().then(async (a) => {
    if (!a.user) redirect("/login");
    return { user: a.user, profile: a.profile };
  });
  const id = Number(formData.get("profileId"));
  const [{ total }] = await db.select({ total: count() }).from(profiles).where(eq(profiles.userId, user.id));
  if (total <= 1) redirect("/profiles?error=last");
  await db.delete(profiles).where(and(eq(profiles.id, id), eq(profiles.userId, user.id)));
  if (active?.id === id) await clearActiveProfileCookie();
  revalidatePath("/profiles");
  redirect("/profiles");
}
