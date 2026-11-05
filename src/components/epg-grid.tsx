"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, Check, CircleDot, Loader2, Play, X } from "lucide-react";
import { ChannelLogo } from "@/components/channel-logo";
import { useHydrated } from "@/components/time-text";
import { cn } from "@/lib/utils";

export interface EpgChannel {
  id: number;
  name: string;
  logoUrl: string | null;
  channelNumber: number | null;
}

export interface EpgProgram {
  id: number;
  channelId: number;
  title: string;
  genre: string | null;
  description: string | null;
  source?: string;
  start: string; // ISO
  end: string; // ISO
}

const PX_PER_MIN = 6;
const CHANNEL_COL = 200;

export function EpgGrid({
  channels,
  programs,
  windowStart,
  windowEnd,
  canRecord = true,
}: {
  channels: EpgChannel[];
  programs: EpgProgram[];
  windowStart: string;
  windowEnd: string;
  canRecord?: boolean;
}) {
  const start = useMemo(() => new Date(windowStart).getTime(), [windowStart]);
  const end = useMemo(() => new Date(windowEnd).getTime(), [windowEnd]);
  const totalMinutes = (end - start) / 60000;
  const width = totalMinutes * PX_PER_MIN;
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydrated = useHydrated();
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<{ program: EpgProgram; channel: EpgChannel } | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [scheduledIds, setScheduledIds] = useState<Set<number>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Scroll so that "now" sits near the left edge on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hydrated) return;
    const offset = ((Date.now() - start) / 60000) * PX_PER_MIN - 120;
    el.scrollLeft = Math.max(0, offset);
  }, [start, hydrated]);

  // Close dialog with Escape
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.keyCode === 10009 || e.keyCode === 461) {
        e.preventDefault();
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const byChannel = useMemo(() => {
    const map = new Map<number, EpgProgram[]>();
    for (const p of programs) {
      const list = map.get(p.channelId) ?? [];
      list.push(p);
      map.set(p.channelId, list);
    }
    return map;
  }, [programs]);

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    const firstHour = Math.ceil(start / 3600000) * 3600000;
    for (let t = firstHour; t < end; t += 3600000) marks.push(t);
    return marks;
  }, [start, end]);

  const nowX = ((now - start) / 60000) * PX_PER_MIN;
  const fmt = (t: number) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  async function schedule() {
    if (!selected) return;
    setScheduling(true);
    setMessage(null);
    try {
      const res = await fetch("/api/recordings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: selected.channel.id, programId: selected.program.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo programar");
      setScheduledIds((s) => new Set(s).add(selected.program.id));
      setMessage("Grabación programada. La encontrarás en «Grabaciones».");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al programar la grabación");
    } finally {
      setScheduling(false);
    }
  }

  if (!hydrated) {
    return (
      <div className="space-y-px overflow-hidden rounded-2xl border border-white/5 bg-surface-2/80">
        <div className="h-10 border-b border-white/5" />
        {channels.map((ch) => (
          <div key={ch.id} className="flex h-[60px] items-center gap-3 border-b border-white/5 px-3 last:border-b-0">
            <ChannelLogo name={ch.name} logoUrl={ch.logoUrl} className="h-9 w-12 shrink-0" textClassName="text-[10px]" />
            <span className="w-40 truncate text-sm text-slate-100">{ch.name}</span>
            <div className="h-7 flex-1 animate-pulse rounded-lg bg-white/5" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="scrollbar-thin relative max-h-[75vh] overflow-auto rounded-2xl border border-white/5 bg-surface-2/80"
      >
        <div style={{ width: CHANNEL_COL + width }} className="relative">
          {/* Header */}
          <div className="sticky top-0 z-20 flex border-b border-white/5 bg-surface-2/95 backdrop-blur">
            <div
              style={{ width: CHANNEL_COL }}
              className="sticky left-0 z-30 shrink-0 border-r border-white/5 bg-surface-2/95 px-4 py-3 text-xs font-semibold tracking-wider text-slate-400 uppercase"
            >
              Canal
            </div>
            <div className="relative h-10 flex-1">
              {hourMarks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 flex h-full items-center border-l border-white/10 pl-2 text-xs tabular-nums text-slate-400"
                  style={{ left: ((t - start) / 60000) * PX_PER_MIN }}
                >
                  {fmt(t)}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          {channels.map((ch) => {
            const list = byChannel.get(ch.id) ?? [];
            return (
              <div key={ch.id} className="flex border-b border-white/5 last:border-b-0">
                <Link
                  href={`/watch/${ch.id}`}
                  style={{ width: CHANNEL_COL }}
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-3 border-r border-white/5 bg-surface-2/95 px-3 py-2 backdrop-blur transition hover:bg-surface-3"
                >
                  <span className="w-6 text-right text-xs tabular-nums text-slate-500">{ch.channelNumber ?? "·"}</span>
                  <ChannelLogo name={ch.name} logoUrl={ch.logoUrl} className="h-9 w-12 shrink-0" textClassName="text-[10px]" />
                  <span className="truncate text-sm text-slate-100">{ch.name}</span>
                </Link>
                <div className="relative h-[60px] flex-1">
                  {list.map((p) => {
                    const ps = new Date(p.start).getTime();
                    const pe = new Date(p.end).getTime();
                    const s = Math.max(start, ps);
                    const e = Math.min(end, pe);
                    if (e <= s) return null;
                    const left = ((s - start) / 60000) * PX_PER_MIN;
                    const w = ((e - s) / 60000) * PX_PER_MIN;
                    const live = now >= ps && now < pe;
                    const past = now >= pe;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setMessage(null);
                          setSelected({ program: p, channel: ch });
                        }}
                        title={p.title}
                        style={{ left: left + 2, width: Math.max(8, w - 4) }}
                        className={cn(
                          "absolute top-1.5 bottom-1.5 overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition",
                          live
                            ? "border-brand/50 bg-brand/25 hover:bg-brand/35"
                            : past
                              ? "border-white/5 bg-white/[0.03] text-slate-500 hover:bg-white/5"
                              : "border-white/10 bg-surface-3/80 hover:bg-surface-4",
                        )}
                      >
                        <p className={cn("truncate text-xs font-medium", live ? "text-white" : past ? "text-slate-500" : "text-slate-200")}>
                          {scheduledIds.has(p.id) && <CircleDot className="mr-1 inline h-3 w-3 text-red-400" />}
                          {p.title}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {fmt(ps)}
                          {p.genre ? ` · ${p.genre}` : ""}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Now line */}
          {nowX >= 0 && nowX <= width && (
            <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-red-500" style={{ left: CHANNEL_COL + nowX }}>
              <span className="absolute top-10 -left-[5px] h-2.5 w-2.5 rounded-full bg-red-500 shadow shadow-red-500/50" />
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            data-tv-dialog
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-2 p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-brand-2 uppercase">
                  {selected.channel.name}
                  {selected.program.source === "xmltv" && (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">EPG real</span>
                  )}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">{selected.program.title}</h3>
                <p className="mt-0.5 text-sm tabular-nums text-slate-400">
                  {fmt(new Date(selected.program.start).getTime())} – {fmt(new Date(selected.program.end).getTime())}
                  {selected.program.genre ? ` · ${selected.program.genre}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            {selected.program.description && (
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{selected.program.description}</p>
            )}
            {message && <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-200">{message}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href={`/watch/${selected.channel.id}`}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-surface hover:bg-slate-200"
              >
                <Play className="h-4 w-4 fill-current" /> Ver canal
              </Link>
              {canRecord && new Date(selected.program.end).getTime() > now && (
                <button
                  type="button"
                  onClick={() => void schedule()}
                  disabled={scheduling || scheduledIds.has(selected.program.id)}
                  className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-500/25 disabled:opacity-60"
                >
                  {scheduling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : scheduledIds.has(selected.program.id) ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <CalendarPlus className="h-4 w-4" />
                  )}
                  {scheduledIds.has(selected.program.id)
                    ? "Programada"
                    : new Date(selected.program.start).getTime() <= now
                      ? "Grabar ahora"
                      : "Programar grabación"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
