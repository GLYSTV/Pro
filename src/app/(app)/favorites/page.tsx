import type { Metadata } from "next";
import Link from "next/link";
import { Download, Heart } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { ChannelCard } from "@/components/channel-card";
import { listChannels } from "@/lib/channels";
import { ensureEpg, getNowPlaying } from "@/lib/epg";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Favoritos" };

export default async function FavoritesPage() {
  const { user, profile } = await requireProfile();
  const result = await listChannels({
    userId: user.id,
    profileId: profile.id,
    kidsOnly: profile.isKids,
    onlyFavorites: true,
    limit: 200,
  });
  const now = new Date();
  await ensureEpg(result.items.map((c) => ({ id: c.id, categorySlug: c.categorySlug })), now, now);
  const nowPlaying = await getNowPlaying(result.items.map((c) => c.id), now);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brand-2 uppercase">
            <Heart className="h-3.5 w-3.5" /> Tu selección
          </p>
          <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Favoritos</h1>
          <p className="mt-1 text-sm text-slate-400">
            {result.total === 0
              ? "Marca canales con el corazón para tenerlos siempre a mano."
              : `${result.total} ${result.total === 1 ? "canal guardado" : "canales guardados"}`}
          </p>
        </div>
        {result.total > 0 && (
          <a
            href="/api/export?favorites=1"
            className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            <Download className="h-4 w-4" /> Exportar favoritos (.m3u)
          </a>
        )}
      </div>

      {result.items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-surface-2/50 px-6 py-16 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/15">
            <Heart className="h-7 w-7 text-rose-300" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-white">Aún no tienes favoritos</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Pulsa el icono de corazón en cualquier canal para añadirlo aquí.
          </p>
          <Link href="/" className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90">
            Explorar canales
          </Link>
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {result.items.map((c) => (
            <ChannelCard key={c.id} channel={c} nowPlaying={nowPlaying.get(c.id) ?? null} />
          ))}
        </section>
      )}
    </div>
  );
}
