"use client";

import { useActionState, useEffect, useState } from "react";
import { Baby, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  createProfileAction,
  deleteProfileAction,
  selectProfileAction,
  updateProfileAction,
  type ProfileFormState,
} from "@/app/(account)/profiles/actions";
import { AVATARS, COLORS, MAX_PROFILES } from "@/lib/profile-options";
import { cn } from "@/lib/utils";

export interface ProfileView {
  id: number;
  name: string;
  avatar: string;
  color: string;
  isKids: boolean;
}

function ProfileForm({
  profile,
  onClose,
}: {
  profile: ProfileView | null;
  onClose: () => void;
}) {
  const action = profile ? updateProfileAction : createProfileAction;
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(action, {});
  const [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS[0]);
  const [color, setColor] = useState(profile?.color ?? COLORS[0]);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form
      action={formAction}
      data-tv-dialog
      className="w-full max-w-md space-y-5 rounded-3xl border border-white/10 bg-surface-2 p-6 shadow-2xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">{profile ? "Editar perfil" : "Nuevo perfil"}</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>
      {profile && <input type="hidden" name="profileId" value={profile.id} />}
      <input type="hidden" name="avatar" value={avatar} />
      <input type="hidden" name="color" value={color} />

      <div className="flex items-center gap-4">
        <div
          className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl text-4xl shadow-lg"
          style={{ background: `linear-gradient(135deg, ${color}, ${color}88)` }}
        >
          {avatar}
        </div>
        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-medium text-slate-400">Nombre</span>
          <input
            name="name"
            defaultValue={profile?.name ?? ""}
            required
            maxLength={30}
            autoFocus
            className="w-full rounded-xl border border-white/10 bg-surface-3 px-3.5 py-2.5 text-sm text-white focus:border-brand/60 focus:outline-none"
          />
        </label>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-400">Avatar</p>
        <div className="grid grid-cols-8 gap-1.5">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAvatar(a)}
              className={cn(
                "grid aspect-square place-items-center rounded-xl text-xl transition",
                avatar === a ? "bg-white/15 ring-2 ring-brand" : "bg-white/5 hover:bg-white/10",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-400">Color</p>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn("grid h-8 w-8 place-items-center rounded-full transition", color === c && "ring-2 ring-white ring-offset-2 ring-offset-surface-2")}
              style={{ background: c }}
              aria-label={c}
            >
              {color === c && <Check className="h-4 w-4 text-white" />}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
        <input type="checkbox" name="isKids" defaultChecked={profile?.isKids ?? false} className="h-4 w-4 accent-brand" />
        <span className="flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-white">
            <Baby className="h-4 w-4 text-brand-2" /> Perfil infantil
          </span>
          <span className="block text-xs text-slate-400">Solo verá los canales de la categoría Infantil.</span>
        </span>
      </label>

      {state.error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {profile ? "Guardar cambios" : "Crear y entrar"}
      </button>
    </form>
  );
}

export function ProfilesUi({
  profiles,
  activeId,
  userName,
  error,
}: {
  profiles: ProfileView[];
  activeId: number | null;
  userName: string;
  error?: string;
}) {
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<ProfileView | "new" | null>(null);

  return (
    <div className="w-full max-w-4xl text-center">
      <p className="text-sm text-slate-400">Hola, {userName}</p>
      <h1 className="mt-1 text-3xl font-bold text-white sm:text-4xl">¿Quién está viendo?</h1>

      {error === "last" && (
        <p className="mx-auto mt-4 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          No puedes eliminar el único perfil de la cuenta.
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-start justify-center gap-6">
        {profiles.map((p) => (
          <div key={p.id} className="relative w-32 sm:w-36">
            <form action={selectProfileAction}>
              <input type="hidden" name="profileId" value={p.id} />
              <button
                type="submit"
                disabled={manage}
                className="group flex w-full flex-col items-center gap-3 focus:outline-none"
              >
                <span
                  className={cn(
                    "grid aspect-square w-full place-items-center rounded-3xl text-5xl shadow-xl transition group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-white sm:text-6xl",
                    activeId === p.id && "ring-2 ring-white/60",
                    manage && "opacity-60",
                  )}
                  style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color}88)` }}
                >
                  {p.avatar}
                </span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-200 group-hover:text-white">
                  {p.isKids && <Baby className="h-3.5 w-3.5 text-brand-2" />}
                  <span className="truncate">{p.name}</span>
                </span>
              </button>
            </form>
            {manage && (
              <div className="absolute inset-x-0 top-0 flex aspect-square items-center justify-center gap-2 rounded-3xl bg-black/40">
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="rounded-full bg-white p-2.5 text-surface shadow hover:bg-slate-200"
                  aria-label="Editar perfil"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <form
                  action={deleteProfileAction}
                  onSubmit={(e) => {
                    if (!confirm(`¿Eliminar el perfil «${p.name}»? Se perderán sus favoritos, historial y grabaciones.`)) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="profileId" value={p.id} />
                  <button type="submit" className="rounded-full bg-red-500 p-2.5 text-white shadow hover:bg-red-400" aria-label="Eliminar perfil">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}

        {profiles.length < MAX_PROFILES && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="group flex w-32 flex-col items-center gap-3 sm:w-36"
          >
            <span className="grid aspect-square w-full place-items-center rounded-3xl border-2 border-dashed border-white/20 text-slate-400 transition group-hover:border-brand group-hover:text-white group-focus-visible:ring-4 group-focus-visible:ring-white">
              <Plus className="h-10 w-10" />
            </span>
            <span className="text-sm font-medium text-slate-300">Añadir perfil</span>
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setManage((m) => !m)}
        className={cn(
          "mt-10 rounded-full border px-5 py-2 text-sm font-medium transition",
          manage ? "border-white bg-white text-surface" : "border-white/20 text-slate-300 hover:border-white hover:text-white",
        )}
      >
        {manage ? "Listo" : "Administrar perfiles"}
      </button>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
            <ProfileForm key={editing === "new" ? "new" : editing.id} profile={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
