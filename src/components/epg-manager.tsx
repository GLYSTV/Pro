"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarRange, CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { TimeText } from "@/components/time-text";
import { cn } from "@/lib/utils";

export interface EpgSourceView {
  id: number;
  name: string;
  url: string;
  lastFetchedAt: string | null;
  channelCount: number;
  programCount: number;
  lastError: string | null;
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-surface-3 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand/60 focus:ring-2 focus:ring-brand/30 focus:outline-none";

export function EpgManager({ sources }: { sources: EpgSourceView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/epg-sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al importar");
      setSuccess(
        `Importados ${data.programs} programas para ${data.matchedChannels} canales (${data.xmlChannels} canales en el XML).` +
          (data.matchedChannels === 0
            ? " Ningún canal coincidió: comprueba que los canales tengan tvg-id o nombres equivalentes."
            : ""),
      );
      setName("");
      setUrl("");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      startTransition(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  async function refresh(id: number) {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/epg-sources/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al actualizar");
      setNotice(`Actualizado: ${data.programs} programas · ${data.matchedChannels} canales emparejados.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setBusy(null);
      startTransition(() => router.refresh());
    }
  }

  async function remove(id: number) {
    if (!confirm("¿Eliminar esta fuente EPG y su programación importada?")) return;
    setBusy(id);
    try {
      await fetch(`/api/epg-sources/${id}`, { method: "DELETE" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-white/5 bg-surface-2/80 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <CalendarRange className="h-4 w-4 text-brand-2" /> Añadir fuente XMLTV
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-400">Nombre (opcional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="EPG España" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-400">URL del XMLTV (.xml o .xml.gz)</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            required
            placeholder="https://…/guide.xml.gz"
            className={cn(inputCls, "font-mono text-xs")}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            Ejemplo público:{" "}
            <button
              type="button"
              onClick={() => {
                setUrl("https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv.xml.gz");
                setName("EPG España (dobleM)");
              }}
              className="text-brand-2 hover:underline"
            >
              guía TDT España
            </button>
          </p>
        </label>

        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {success && (
          <p className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {success}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
          {loading ? "Descargando e importando…" : "Importar guía"}
        </button>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Los programas se emparejan con tus canales por <code>tvg-id</code> y, si no existe, por nombre normalizado. Se
          importan los próximos 7 días. Donde no haya datos reales, la guía muestra una parrilla generada.
        </p>
      </form>

      <div className="rounded-2xl border border-white/5 bg-surface-2/80">
        <div className="border-b border-white/5 px-5 py-4">
          <h3 className="font-semibold text-white">Fuentes EPG</h3>
          <p className="text-xs text-slate-500">{sources.length === 0 ? "Ninguna todavía" : `${sources.length} fuente(s)`}</p>
          {notice && <p className="mt-2 text-xs text-brand-2">{notice}</p>}
        </div>
        {sources.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Añade una fuente XMLTV para tener programación real.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {sources.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{s.name}</p>
                  <p className="truncate font-mono text-xs text-slate-500" title={s.url}>
                    {s.url}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {s.programCount} programas · {s.channelCount} canales
                    {s.lastFetchedAt ? (
                      <>
                        {" · actualizado "}
                        <TimeText date={s.lastFetchedAt} mode="datetime" />
                      </>
                    ) : (
                      " · aún no importado"
                    )}
                  </p>
                  {s.lastError && <p className="mt-1 text-xs text-red-300">{s.lastError}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => refresh(s.id)}
                    disabled={busy === s.id}
                    className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
                    title="Actualizar"
                    aria-label="Actualizar"
                  >
                    {busy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    disabled={busy === s.id}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                    title="Eliminar"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
