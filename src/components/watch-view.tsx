"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock3,
  ExternalLink,
  Globe2,
  Languages,
  ListVideo,
  Loader2,
  Search,
  Tv2,
} from "lucide-react";
import { ChannelLogo } from "@/components/channel-logo";
import { FavoriteButton } from "@/components/favorite-button";
import { Player } from "@/components/player";
import { TimeText } from "@/components/time-text";
import type { ChannelListItem } from "@/lib/channels";
import type { Program } from "@/db/schema";
import { cn, countryFlag, programProgress } from "@/lib/utils";

const DURATIONS = [30, 60, 90, 120, 180];

export function WatchView({
  channel,
  zapList,
  nowPlaying,
  upcoming,
  canRecord = true,
}: {
  channel: ChannelListItem;
  zapList: ChannelListItem[];
  nowPlaying: Program | null;
  upcoming: Program[];
  canRecord?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // TV remote: direct channel number entry
  const [typed, setTyped] = useState("");
  const typedRef = useRef("");
  const typedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Recording UI
  const [recordMenu, setRecordMenu] = useState(false);
  const [recording, setRecording] = useState(false);
  const [scheduled, setScheduled] = useState<Set<number>>(() => new Set());

  const index = zapList.findIndex((c) => c.id === channel.id);
  const prev = index > 0 ? zapList[index - 1] : zapList[zapList.length - 1];
  const next = index >= 0 && index < zapList.length - 1 ? zapList[index + 1] : zapList[0];

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Record watch history
  useEffect(() => {
    void fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: channel.id }),
    }).catch(() => undefined);
  }, [channel.id]);

  const zap = useCallback(
    (direction: 1 | -1) => {
      if (zapList.length < 2) return;
      const target = direction === 1 ? next : prev;
      if (target) router.push(`/watch/${target.id}`);
    },
    [next, prev, router, zapList.length],
  );

  const goToNumber = useCallback(
    async (value: string) => {
      typedRef.current = "";
      setTyped("");
      const number = Number(value);
      if (!number) return;
      try {
        const res = await fetch(`/api/channels?number=${number}&limit=1`);
        const data = (await res.json()) as { items?: Array<{ id: number }> };
        const target = data.items?.[0];
        if (target) router.push(`/watch/${target.id}`);
        else showToast(`No existe el canal ${number}`);
      } catch {
        showToast("No se pudo cambiar de canal");
      }
    },
    [router, showToast],
  );

  // Keyboard zapping + numeric entry + custom remote events
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        zap(-1);
      } else if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        zap(1);
      } else if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const value = (typedRef.current + e.key).slice(-4);
        typedRef.current = value;
        setTyped(value);
        if (typedTimer.current) clearTimeout(typedTimer.current);
        typedTimer.current = setTimeout(() => void goToNumber(value), 1800);
      } else if (e.key === "Enter" && typedRef.current) {
        e.preventDefault();
        if (typedTimer.current) clearTimeout(typedTimer.current);
        void goToNumber(typedRef.current);
      }
    };
    const onZapEvent = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      zap(detail < 0 ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("glystv:zap", onZapEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("glystv:zap", onZapEvent);
      if (typedTimer.current) clearTimeout(typedTimer.current);
    };
  }, [zap, goToNumber]);

  // Prefetch neighbours for instant zapping
  useEffect(() => {
    if (prev) router.prefetch(`/watch/${prev.id}`);
    if (next) router.prefetch(`/watch/${next.id}`);
  }, [prev, next, router]);

  // Keep the active channel visible in the list
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [channel.id]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return zapList;
    return zapList.filter((c) => c.name.toLowerCase().includes(f));
  }, [zapList, filter]);

  const progress = nowPlaying ? programProgress(nowPlaying.startTime, nowPlaying.endTime) : 0;

  async function createRecording(payload: Record<string, unknown>, successMessage: string) {
    setRecording(true);
    setRecordMenu(false);
    try {
      const res = await fetch("/api/recordings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: channel.id, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo programar la grabación");
      showToast(successMessage);
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al grabar");
      return false;
    } finally {
      setRecording(false);
    }
  }

  async function recordProgram(program: Program) {
    const ok = await createRecording({ programId: program.id }, `Grabación programada: ${program.title}`);
    if (ok) setScheduled((s) => new Set(s).add(program.id));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="relative min-w-0 space-y-5">
        <Player key={channel.id} streamUrl={channel.streamUrl} name={channel.name} logoUrl={channel.logoUrl} />

        {typed && (
          <div className="pointer-events-none absolute top-4 right-4 z-20 rounded-2xl bg-black/80 px-5 py-3 text-3xl font-bold tabular-nums text-white shadow-2xl ring-1 ring-white/20">
            {typed}
            <span className="ml-1 animate-pulse text-brand-2">_</span>
          </div>
        )}
        {toast && (
          <div className="pointer-events-none absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/85 px-4 py-2 text-sm text-white shadow-xl ring-1 ring-white/15">
            {toast}
          </div>
        )}

        {/* Channel header */}
        <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-surface-2/80 p-5 sm:flex-row sm:items-start">
          <ChannelLogo name={channel.name} logoUrl={channel.logoUrl} className="h-16 w-24 shrink-0" textClassName="text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {channel.channelNumber != null && (
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-200">
                  CH {channel.channelNumber}
                </span>
              )}
              <h1 className="text-xl font-bold text-white sm:text-2xl">{channel.name}</h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
              {channel.categoryName && (
                <Link href={`/?category=${channel.categorySlug}`} className="inline-flex items-center gap-1.5 hover:text-white">
                  <Tv2 className="h-4 w-4" /> {channel.categoryName}
                </Link>
              )}
              {channel.country && (
                <span className="inline-flex items-center gap-1.5">
                  <Globe2 className="h-4 w-4" /> {countryFlag(channel.country)} {channel.country}
                </span>
              )}
              {channel.language && (
                <span className="inline-flex items-center gap-1.5">
                  <Languages className="h-4 w-4" /> {channel.language.toUpperCase()}
                </span>
              )}
              {channel.playlistId && (
                <Link href={`/?playlist=${channel.playlistId}`} className="inline-flex items-center gap-1.5 hover:text-white">
                  <ListVideo className="h-4 w-4" /> Lista importada
                </Link>
              )}
            </div>
            {channel.description && <p className="mt-3 text-sm leading-relaxed text-slate-300">{channel.description}</p>}
            <a
              href={channel.streamUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate text-xs text-slate-500 hover:text-slate-300"
              title={channel.streamUrl}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{channel.streamUrl}</span>
            </a>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <FavoriteButton channelId={channel.id} initial={channel.isFavorite} size="md" showLabel />
            {canRecord && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRecordMenu((m) => !m)}
                  disabled={recording}
                  className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-500/25 disabled:opacity-60"
                >
                  {recording ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDot className="h-4 w-4" />}
                  Grabar ahora
                </button>
                {recordMenu && (
                  <div
                    data-tv-dialog
                    className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-surface-2 p-1.5 shadow-2xl"
                  >
                    <p className="px-3 py-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Duración</p>
                    {DURATIONS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() =>
                          void createRecording(
                            { startNow: true, durationMinutes: m, title: nowPlaying?.title },
                            `Grabando «${nowPlaying?.title ?? channel.name}» durante ${m} min`,
                          )
                        }
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-200 hover:bg-white/10 hover:text-white"
                      >
                        {m < 60 ? `${m} minutos` : `${m / 60} ${m === 60 ? "hora" : "horas"}${m % 60 ? ` ${m % 60} min` : ""}`}
                      </button>
                    ))}
                    {nowPlaying && (
                      <button
                        type="button"
                        onClick={() => void recordProgram(nowPlaying)}
                        className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-white/5 px-3 py-2 text-left text-sm text-brand-2 hover:bg-white/10"
                      >
                        <CalendarPlus className="h-4 w-4 shrink-0" /> Hasta el final de «{nowPlaying.title}»
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* EPG now / next */}
        <div className="rounded-2xl border border-white/5 bg-surface-2/80 p-5">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-semibold text-white">
              <Clock3 className="h-4 w-4 text-brand-2" /> Programación
              {nowPlaying?.source === "xmltv" && (
                <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-emerald-300 uppercase">
                  EPG real
                </span>
              )}
            </h2>
            <Link href="/guide" className="text-xs text-slate-400 hover:text-white">
              Ver guía completa →
            </Link>
          </div>
          {nowPlaying ? (
            <div className="mt-4 rounded-xl border border-brand/30 bg-brand/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold tracking-wider text-brand-2 uppercase">Ahora</p>
                <p className="text-xs tabular-nums text-slate-400">
                  <TimeText date={nowPlaying.startTime} /> – <TimeText date={nowPlaying.endTime} />
                </p>
              </div>
              <p className="mt-1 text-lg font-semibold text-white">{nowPlaying.title}</p>
              {nowPlaying.description && <p className="mt-1 text-sm text-slate-300">{nowPlaying.description}</p>}
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Sin información de programación.</p>
          )}
          {upcoming.length > 0 && (
            <ul className="mt-3 divide-y divide-white/5">
              {upcoming.map((p) => (
                <li key={p.id} className="flex items-center gap-4 py-2.5 text-sm">
                  <span className="w-12 shrink-0 tabular-nums text-slate-400">
                    <TimeText date={p.startTime} />
                  </span>
                  <span className="flex-1 truncate text-slate-200">{p.title}</span>
                  {p.genre && <span className="hidden rounded bg-white/5 px-2 py-0.5 text-xs text-slate-400 sm:inline">{p.genre}</span>}
                  {canRecord && (
                    <button
                      type="button"
                      onClick={() => void recordProgram(p)}
                      disabled={scheduled.has(p.id) || recording}
                      className={cn(
                        "rounded-lg p-1.5 transition",
                        scheduled.has(p.id)
                          ? "text-emerald-300"
                          : "text-slate-500 hover:bg-red-500/10 hover:text-red-300",
                      )}
                      title={scheduled.has(p.id) ? "Grabación programada" : "Programar grabación"}
                      aria-label={scheduled.has(p.id) ? "Grabación programada" : "Programar grabación"}
                    >
                      {scheduled.has(p.id) ? <Check className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Zap list */}
      <aside
        data-tv-list
        className="flex max-h-[80vh] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-white/5 bg-surface-2/80 xl:sticky xl:top-8"
      >
        <div className="border-b border-white/5 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">
              {channel.categoryName ? `Canales de ${channel.categoryName}` : "Todos los canales"}
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => zap(-1)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Canal anterior"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => zap(1)}
                className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Canal siguiente"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar…"
              className="w-full rounded-xl border border-white/10 bg-surface-3 py-2 pr-3 pl-9 text-sm text-white placeholder:text-slate-500 focus:border-brand/60 focus:outline-none"
            />
          </div>
        </div>
        <div ref={listRef} className="scrollbar-thin flex-1 overflow-y-auto p-2">
          {filtered.map((c) => {
            const active = c.id === channel.id;
            return (
              <Link
                key={c.id}
                href={`/watch/${c.id}`}
                ref={active ? activeRef : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-2.5 py-2 transition",
                  active ? "bg-brand/20 ring-1 ring-brand/40" : "hover:bg-white/5",
                )}
              >
                <span className="w-7 shrink-0 text-right text-xs tabular-nums text-slate-500">{c.channelNumber ?? "·"}</span>
                <ChannelLogo name={c.name} logoUrl={c.logoUrl} className="h-9 w-12 shrink-0" textClassName="text-[10px]" />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm", active ? "font-semibold text-white" : "text-slate-200")}>{c.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {c.country ? `${countryFlag(c.country)} ` : ""}
                    {c.groupTitle ?? c.categoryName ?? ""}
                  </p>
                </div>
                {active && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />}
              </Link>
            );
          })}
          {filtered.length === 0 && <p className="p-4 text-center text-sm text-slate-500">Sin coincidencias</p>}
        </div>
      </aside>
    </div>
  );
}
