import type { Metadata } from "next";
import { ProfilesUi } from "@/components/profiles-ui";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/(auth)/actions";
import { LogOut } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Perfiles" };

export default async function ProfilesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user, profile, profiles } = await requireUser();
  const sp = await searchParams;

  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-12">
      <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: "url(/images/hero.jpg)" }} aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/80 via-surface/90 to-surface" aria-hidden />
      <div className="relative flex w-full flex-col items-center gap-8">
        <ProfilesUi
          profiles={profiles.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color, isKids: p.isKids }))}
          activeId={profile?.id ?? null}
          userName={user.name}
          error={sp.error}
        />
        <form action={logoutAction}>
          <button type="submit" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
            <LogOut className="h-4 w-4" /> Cerrar sesión ({user.username})
          </button>
        </form>
      </div>
    </div>
  );
}
