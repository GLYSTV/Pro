"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, ClipboardPaste, Link2, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import type { Playlist } from "@/db/schema";
import { cn, formatDateTime } from "@/lib/utils";

type Mode = "url" | "paste";

interface ImportResult {
  imported: number;
  parsed: number;
  duplicates: number;
  truncated: boolean;
  playlist: Playlist;
}

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="dw.es" tvg-logo="https://i.imgur.com/8MRNFb9.png" group-title="Noticias",DW Español
https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8
#EXTINF:-1 tvg-logo="https://images.pluto.tv/channels/5e7cb84a172a0f0007da69e4/colorLogoPNG.png" group-title="Deportes",Red Bull TV
https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8`;

export function PlaylistManager({ playlists }: { playlists: Playlist[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function refresh(id: number) {
    setRefreshing(id);
    setRefreshNotice(null);
    try {
      const res = await fetch(`/api/playlists/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al actualizar");
      setRefreshNotice(`Lista actualizada: ${data.imported} nuevos, ${data.updated} actualizados, ${data.removed} eliminados`);
      startTransition(() => router.refresh());
    } catch (err) {
      setRefreshNotice(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setRefreshing(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "url" ? { name, url } : { name, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al importar");
      setResult({ ...data, playlist: data.playlist } as ImportResult);
      setName("");
      setUrl("");
      setContent("");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("¿Eliminar esta lista y todos sus canales?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/playlists/${id}`, { method: "DELETE" });
      startTransition(() => router.refresh());
    } finally {
      setDeleting(null);
    }
  }

  const tab = (m: Mode, label: string, Icon: typeof Link2) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
        mode === m ? "bg-white/10 text-white" : "text-slate-400 hover:text-white",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-surface-3 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand/60 focus:ring-2 focus:ring-brand/30 focus:outline-none";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-white/5 bg-surface-2/80 p-5">
        <div className="flex items-center gap-1 rounded-xl bg-black/20 p-1">
          {tab("url", "Desde URL", Link2)}
          {tab("paste", "Pegar contenido", ClipboardPaste)}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-400">Nombre de la lista (opcional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi lista" className={inputCls} />
        </label>

        {mode === "url" ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-400">URL de la lista M3U / M3U8</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ejemplo.com/lista.m3u"
              type="url"
              required
              className={inputCls}
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Ejemplo público:{" "}
              <button
                type="button"
                onClick={() => setUrl("https://iptv-org.github.io/iptv/languages/spa.m3u")}
                className="text-brand-2 hover:underline"
              >
                iptv-org · canales en español
              </button>
            </p>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-400">
              Contenido M3U
              <button type="button" onClick={() => setContent(SAMPLE)} className="text-brand-2 hover:underline">
                Usar ejemplo
              </button>
            </span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={9}
              required
              placeholder={"#EXTM3U\n#EXTINF:-1 tvg-logo=\"…\" group-title=\"Noticias\",Mi canal\nhttps://…/index.m3u8"}
              className={cn(inputCls, "font-mono text-xs")}
            />
          </label>
        )}

        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {result && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Importados {result.imported} canales en «{result.playlist.name}»
            </p>
            <p className="mt-1 text-xs text-emerald-200/80">
              {result.parsed} entradas analizadas
              {result.duplicates > 0 ? ` · ${result.duplicates} duplicados omitidos` : ""}
              {result.truncated ? " · lista recortada a 5000 canales" : ""}
              {" · "}
              <Link href={`/?playlist=${result.playlist.id}`} className="underline">
                ver canales
              </Link>
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {loading ? "Importando…" : "Importar lista"}
        </button>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Se reconocen los atributos <code>tvg-id</code>, <code>tvg-logo</code>, <code>group-title</code>,{" "}
          <code>tvg-language</code> y <code>tvg-country</code>. Los grupos se asignan automáticamente a categorías
          (y se crean nuevas si hace falta). Máximo 5000 canales por lista.
        </p>
      </form>

      <div className="rounded-2xl border border-white/5 bg-surface-2/80">
        <div className="border-b border-white/5 px-5 py-4">
          <h2 className="font-semibold text-white">Listas importadas</h2>
          <p className="text-xs text-slate-500">{playlists.length === 0 ? "Ninguna todavía" : `${playlists.length} lista(s)`}</p>
          {refreshNotice && <p className="mt-2 text-xs text-brand-2">{refreshNotice}</p>}
        </div>
        {playlists.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            Importa tu primera lista para ver aquí sus datos.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {playlists.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{p.name}</p>
                  <p className="truncate text-xs text-slate-500" title={p.sourceUrl ?? ""}>
                    {p.sourceUrl ?? "Contenido pegado"} · {formatDateTime(p.createdAt)}
                  </p>
                </div>
                <Link
                  href={`/?playlist=${p.id}`}
                  className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 hover:bg-white/10"
                >
                  {p.channelCount} canales
                </Link>
                {p.kind === "xtream" && (
                  <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-brand-2 uppercase">
                    Xtream
                  </span>
                )}
                {p.kind === "m3u" && p.sourceUrl && (
                  <button
                    type="button"
                    onClick={() => refresh(p.id)}
                    disabled={refreshing === p.id}
                    className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
                    aria-label="Actualizar lista"
                    title="Volver a descargar la lista"
                  >
                    {refreshing === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  disabled={deleting === p.id}
                  className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                  aria-label="Eliminar lista"
                >
                  {deleting === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
