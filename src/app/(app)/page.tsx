import Link from "next/link";
import { Suspense } from "react";
import { Clock3, ListVideo, Play, Radio, Sparkles, Tv2 } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { ChannelCard } from "@/components/channel-card";
import { ChannelLogo } from "@/components/channel-logo";
import { CategoryIcon } from "@/components/category-icon";
import { Pagination } from "@/components/pagination";
import { SearchBar } from "@/components/search-bar";
import {
  getRecentlyWatched,
  getStats,
  listCategoriesWithCounts,
  listChannels,
} from "@/lib/channels";
import { ensureEpg, getNowPlaying } from "@/lib/epg";
import { cn, formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; category?: string; page?: string; playlist?: string }>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const { user, profile } = await requireProfile();
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const category = sp.category || undefined;
  const playlistId = sp.playlist ? Number(sp.playlist) : undefined;
  const page = sp.page ? Math.max(1, Number(sp.page)) : 1;
  const filtering = Boolean(q || category || playlistId);

  const [result, categories, stats, recent] = await Promise.all([
    listChannels({
      userId: user.id,
      profileId: profile.id,
      kidsOnly: profile.isKids,
      q,
      categorySlug: category,
      playlistId,
      page,
      limit: 36,
    }),
    listCategoriesWithCounts(user.id),
    getStats(user.id, profile.id),
    filtering ? Promise.resolve([]) : getRecentlyWatched(user.id, profile.id, 8, profile.isKids),
  ]);

  const now = new Date();
  await ensureEpg(
    result.items.map((c) => ({ id: c.id, categorySlug: c.categorySlug })),
    now,
    now,
  );
  const nowPlaying = await getNowPlaying(result.items.map((c) => c.id), now);

  const featured = recent[0] ?? result.items.find((c) => c.isFavorite) ?? result.items[0] ?? null;
  const featuredProgram = featured ? nowPlaying.get(featured.id) : null;
  const activeCategory = categories.find((c) => c.slug === category);
  const visibleCategories = profile.isKids ? categories.filter((c) => c.slug === "infantil") : categories;

  return (
    <div className="space-y-8">
      {!filtering && featured && (
        <section className="relative overflow-hidden rounded-3xl border border-white/5">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: "url(/images/hero.jpg)" }}
            aria-hidden
          />
          <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/85 to-surface/30" />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
          <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:p-12">
            <div className="flex flex-col justify-center">
              <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brand-2 uppercase">
                <Sparkles className="h-3.5 w-3.5" /> Hola, {profile.name} · {recent[0] ? "Continuar viendo" : "Canal destacado"}
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
                {featured.name}
              </h1>
              <p className="mt-3 max-w-xl text-sm text-slate-300 sm:text-base">
                {featured.description ??
                  `Canal de ${featured.categoryName ?? "televisión"} disponible en directo. Pulsa reproducir para verlo ahora.`}
              </p>
              {featuredProgram && (
                <p className="mt-3 text-sm text-slate-400">
                  <span className="font-medium text-white">Ahora:</span> {featuredProgram.title}
                  {featuredProgram.genre ? ` · ${featuredProgram.genre}` : ""}
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  href={`/watch/${featured.id}`}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-surface shadow-lg shadow-white/10 transition hover:bg-slate-200"
                >
                  <Play className="h-4 w-4 fill-current" /> Reproducir
                </Link>
                <Link
                  href="/guide"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/10"
                >
                  <Clock3 className="h-4 w-4" /> Ver guía
                </Link>
              </div>
            </div>
            <div className="hidden items-center justify-center lg:flex">
              <div className="relative">
                <div className="absolute -inset-6 rounded-full bg-brand/20 blur-3xl" />
                <ChannelLogo
                  name={featured.name}
                  logoUrl={featured.logoUrl}
                  className="relative h-44 w-64 rounded-3xl border border-white/10 bg-black/30 p-6 shadow-2xl"
                  textClassName="text-5xl"
                />
              </div>
            </div>
          </div>
          <div className="relative grid grid-cols-2 gap-px border-t border-white/5 bg-white/5 sm:grid-cols-4">
            {[
              { label: "Canales", value: stats.totalChannels, icon: Tv2 },
              { label: "Categorías", value: stats.totalCategories, icon: Radio },
              { label: "Favoritos", value: stats.totalFavorites, icon: Sparkles },
              { label: "Listas M3U", value: stats.totalPlaylists, icon: ListVideo },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-3 bg-surface/80 px-5 py-4">
                <s.icon className="h-4.5 w-4.5 text-brand-2" />
                <div>
                  <p className="text-lg font-bold leading-none text-white tabular-nums">{s.value}</p>
                  <p className="mt-1 text-[11px] tracking-wider text-slate-400 uppercase">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-white sm:text-2xl">
              {activeCategory ? activeCategory.name : q ? `Resultados para “${q}”` : playlistId ? "Canales de la lista" : "Todos los canales"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {result.total} {result.total === 1 ? "canal" : "canales"}
              {result.pages > 1 ? ` · página ${result.page} de ${result.pages}` : ""}
            </p>
          </div>
          <Suspense fallback={null}>
            <SearchBar className="md:w-80" />
          </Suspense>
        </div>

        <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <Link
            href={q ? `/?q=${encodeURIComponent(q)}` : "/"}
            className={cn(
              "shrink-0 rounded-full border px-4 py-1.5 text-sm transition",
              !category
                ? "border-brand bg-brand/20 text-white"
                : "border-white/10 bg-surface-3/60 text-slate-300 hover:border-white/20 hover:text-white",
            )}
          >
            Todos
          </Link>
          {visibleCategories
            .filter((c) => c.channelCount > 0)
            .map((c) => (
              <Link
                key={c.id}
                href={`/?category=${encodeURIComponent(c.slug)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition",
                  category === c.slug
                    ? "border-brand bg-brand/20 text-white"
                    : "border-white/10 bg-surface-3/60 text-slate-300 hover:border-white/20 hover:text-white",
                )}
              >
                <CategoryIcon name={c.icon} className="h-3.5 w-3.5" />
                {c.name}
                <span className="text-xs text-slate-500">{c.channelCount}</span>
              </Link>
            ))}
        </div>
      </section>

      {!filtering && recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-brand-2" />
            <h2 className="font-semibold text-white">Vistos recientemente</h2>
          </div>
          <div className="hide-scrollbar flex gap-3 overflow-x-auto pb-2">
            {recent.map((c) => (
              <Link
                key={c.id}
                href={`/watch/${c.id}`}
                className="flex w-56 shrink-0 items-center gap-3 rounded-2xl border border-white/5 bg-surface-2/80 p-3 transition hover:border-brand/40"
              >
                <ChannelLogo name={c.name} logoUrl={c.logoUrl} className="h-12 w-16 shrink-0" textClassName="text-sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{c.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {c.lastWatched ? formatRelative(c.lastWatched) : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {result.items.length === 0 ? (
        <EmptyState hasFilters={filtering} />
      ) : (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {result.items.map((c) => (
            <ChannelCard key={c.id} channel={c} nowPlaying={nowPlaying.get(c.id) ?? null} />
          ))}
        </section>
      )}

      <Pagination
        page={result.page}
        pages={result.pages}
        basePath="/"
        params={{ q, category, playlist: playlistId ? String(playlistId) : undefined }}
      />
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-surface-2/50 px-6 py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/15">
        <Tv2 className="h-7 w-7 text-brand-2" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-white">
        {hasFilters ? "No hay canales que coincidan" : "Todavía no hay canales"}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
        {hasFilters
          ? "Prueba con otra búsqueda o categoría."
          : "Tu catálogo está vacío. Sincroniza tu proveedor en «Fuentes», importa una lista M3U o añade canales de ejemplo."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {hasFilters ? (
          <Link href="/" className="rounded-full bg-white/10 px-5 py-2 text-sm font-medium text-white hover:bg-white/15">
            Ver todos los canales
          </Link>
        ) : (
          <>
            <Link href="/playlists" className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90">
              Ir a Fuentes
            </Link>
            <Link href="/manage" className="rounded-full bg-white/10 px-5 py-2 text-sm font-medium text-white hover:bg-white/15">
              Gestionar canales
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
