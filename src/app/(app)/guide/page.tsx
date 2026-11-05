import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarRange } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { CategoryIcon } from "@/components/category-icon";
import { EpgGrid } from "@/components/epg-grid";
import { Pagination } from "@/components/pagination";
import { SearchBar } from "@/components/search-bar";
import { TimeText } from "@/components/time-text";
import { listCategoriesWithCounts, listChannels } from "@/lib/channels";
import { ensureEpg, getSchedule } from "@/lib/epg";
import { cn, epgWindow } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Guía TV" };

type SearchParams = Promise<{ q?: string; category?: string; page?: string }>;

export default async function GuidePage({ searchParams }: { searchParams: SearchParams }) {
  const { user, profile } = await requireProfile();
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const category = sp.category || undefined;
  const page = sp.page ? Math.max(1, Number(sp.page)) : 1;

  const [result, categories] = await Promise.all([
    listChannels({ userId: user.id, profileId: profile.id, kidsOnly: profile.isKids, q, categorySlug: category, page, limit: 25 }),
    listCategoriesWithCounts(user.id),
  ]);
  const visibleCategories = profile.isKids ? categories.filter((c) => c.slug === "infantil") : categories;

  const { start: windowStart, end: windowEnd, now } = epgWindow(8);

  const channelRefs = result.items.map((c) => ({ id: c.id, categorySlug: c.categorySlug }));
  await ensureEpg(channelRefs, windowStart, windowEnd);
  const programs = await getSchedule(
    result.items.map((c) => c.id),
    windowStart,
    windowEnd,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brand-2 uppercase">
            <CalendarRange className="h-3.5 w-3.5" /> Programación
          </p>
          <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Guía TV</h1>
          <p className="mt-1 text-sm text-slate-400">
            <TimeText date={now} mode="date" /> · {result.total}{" "}
            canales
            {result.pages > 1 ? ` · página ${result.page} de ${result.pages}` : ""}
          </p>
        </div>
        <Suspense fallback={null}>
          <SearchBar className="md:w-80" placeholder="Buscar canal en la guía…" />
        </Suspense>
      </div>

      <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link
          href={q ? `/guide?q=${encodeURIComponent(q)}` : "/guide"}
          className={cn(
            "shrink-0 rounded-full border px-4 py-1.5 text-sm transition",
            !category ? "border-brand bg-brand/20 text-white" : "border-white/10 bg-surface-3/60 text-slate-300 hover:text-white",
          )}
        >
          Todos
        </Link>
        {visibleCategories
          .filter((c) => c.channelCount > 0)
          .map((c) => (
            <Link
              key={c.id}
              href={`/guide?category=${encodeURIComponent(c.slug)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition",
                category === c.slug
                  ? "border-brand bg-brand/20 text-white"
                  : "border-white/10 bg-surface-3/60 text-slate-300 hover:text-white",
              )}
            >
              <CategoryIcon name={c.icon} className="h-3.5 w-3.5" />
              {c.name}
            </Link>
          ))}
      </div>

      {result.items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-surface-2/50 px-6 py-16 text-center text-sm text-slate-400">
          No hay canales para mostrar en la guía.
        </div>
      ) : (
        <EpgGrid
          channels={result.items.map((c) => ({
            id: c.id,
            name: c.name,
            logoUrl: c.logoUrl,
            channelNumber: c.channelNumber,
          }))}
          programs={programs.map((p) => ({
            id: p.id,
            channelId: p.channelId,
            title: p.title,
            genre: p.genre,
            description: p.description,
            source: p.source,
            start: p.startTime.toISOString(),
            end: p.endTime.toISOString(),
          }))}
          windowStart={windowStart.toISOString()}
          windowEnd={windowEnd.toISOString()}
          canRecord={!profile.isKids}
        />
      )}

      <Pagination page={result.page} pages={result.pages} basePath="/guide" params={{ q, category }} />
    </div>
  );
}
