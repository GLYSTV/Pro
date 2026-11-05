"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CircleDot, Clock3, Download, Loader2, Play, Square, Trash2, X } from "lucide-react";
import { TimeText } from "@/components/time-text";
import { cn } from "@/lib/utils";

export interface RecordingView {
  id: number;
  title: string;
  channelName: string;
  channelId: number | null;
  startTime: string;
  endTime: string;
  status: string;
  segmentCount: number;
  sizeBytes: number;
  durationSeconds: number;
  error: string | null;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Programada", cls: "bg-sky-500/15 text-sky-200" },
  recording: { label: "Grabando", cls: "bg-red-500/15 text-red-200" },
  completed: { label: "Completada", cls: "bg-emerald-500/15 text-emerald-300" },
  failed: { label: "Fallida", cls: "bg-amber-500/15 text-amber-200" },
  cancelled: { label: "Cancelada", cls: "bg-white/10 text-slate-400" },
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

export function RecordingsList({ recordings }: { recordings: RecordingView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const hasActive = recordings.some((r) => r.status === "recording" || r.status === "scheduled");

  // Poll while something is scheduled / in progress
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => {
      setNow(Date.now());
      startTransition(() => router.refresh());
    }, 10000);
    return () => clearInterval(t);
  }, [hasActive, router]);

  async function cancel(id: number) {
    setBusy(id);
    try {
      await fetch(`/api/recordings/${id}`, { method: "PATCH" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: number) {
    if (!confirm("¿Eliminar esta grabación y sus archivos?")) return;
    setBusy(id);
    try {
      await fetch(`/api/recordings/${id}`, { method: "DELETE" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  if (recordings.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-white/10 bg-surface-2/50 px-6 py-16 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15">
          <CircleDot className="h-7 w-7 text-red-300" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-white">Todavía no hay grabaciones</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          Pulsa «Grabar ahora» en cualquier canal o elige un programa en la Guía TV para programar su grabación. El
          servidor la capturará aunque cierres el navegador.
        </p>
        <Link href="/guide" className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          Abrir la guía
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {recordings.map((r) => {
        const st = STATUS[r.status] ?? STATUS.scheduled;
        const startMs = new Date(r.startTime).getTime();
        const endMs = new Date(r.endTime).getTime();
        const progress = r.status === "recording" ? Math.min(100, Math.max(0, ((now - startMs) / (endMs - startMs)) * 100)) : 0;
        const playable = r.segmentCount > 0 && (r.status === "completed" || r.status === "recording");
        return (
          <li key={r.id} className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-surface-2/80 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{r.title}</p>
                <p className="truncate text-xs text-slate-400">
                  {r.channelName} · <TimeText date={r.startTime} mode="datetime" /> – <TimeText date={r.endTime} />
                </p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>
                {r.status === "recording" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 align-middle" />}
                {st.label}
              </span>
            </div>

            {r.status === "recording" && (
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-brand-2 transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" /> {formatDuration(r.durationSeconds)}
              </span>
              <span>{formatBytes(r.sizeBytes)}</span>
              <span>{r.segmentCount} segmentos</span>
            </p>
            {r.error && <p className="text-xs text-amber-200">{r.error}</p>}

            <div className="mt-auto flex flex-wrap items-center gap-2">
              {playable && (
                <Link
                  href={`/recordings/${r.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-surface hover:bg-slate-200"
                >
                  <Play className="h-3.5 w-3.5 fill-current" /> Reproducir
                </Link>
              )}
              {r.segmentCount > 0 && r.status !== "recording" && (
                <a
                  href={`/api/recordings/${r.id}/download`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white hover:bg-white/10"
                >
                  <Download className="h-3.5 w-3.5" /> Descargar
                </a>
              )}
              {r.channelId && (
                <Link href={`/watch/${r.channelId}`} className="text-xs text-slate-400 hover:text-white">
                  Ver canal
                </Link>
              )}
              <span className="flex-1" />
              {(r.status === "scheduled" || r.status === "recording") && (
                <button
                  type="button"
                  onClick={() => cancel(r.id)}
                  disabled={busy === r.id}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : r.status === "recording" ? <Square className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  {r.status === "recording" ? "Detener" : "Cancelar"}
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(r.id)}
                disabled={busy === r.id}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                aria-label="Eliminar grabación"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
