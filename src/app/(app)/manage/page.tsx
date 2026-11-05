import type { Metadata } from "next";
import { Settings2 } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { ChannelManager } from "@/components/channel-manager";
import { listCategoriesWithCounts } from "@/lib/channels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Gestionar canales" };

export default async function ManagePage() {
  const { user } = await requireProfile();
  const categories = await listCategoriesWithCounts(user.id);

  return (
    <div className="space-y-6">
      <div>
        <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brand-2 uppercase">
          <Settings2 className="h-3.5 w-3.5" /> Administración
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Gestionar canales</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Añade canales manualmente, edita sus datos, ocúltalos del catálogo o elimínalos. Los canales ocultos no
          aparecen en el inicio, la guía ni el zapping.
        </p>
      </div>

      <ChannelManager categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
