"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, RefreshCw, Server, ShieldAlert, Trash2 } from "lucide-react";
import { TimeText } from "@/components/time-text";
import { cn } from "@/lib/utils";

export interface ProviderView {
  id: number;
  name: string;
  serverUrl: string;
  username: string;
  streamFormat: string;
  includeVod: boolean;
  isPrimary: boolean;
  playlistId: number | null;
  status: string | null;
  expiresAt: string | null;
  maxConnections: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-surface-3 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand/60 focus:ring-2 focus:ring-brand/30 focus:outline-none";

export function ProviderManager({ providers }: { providers: ProviderView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({ name: "", serverUrl: "", username: "", password: "", streamFormat: "m3u8", includeVod: false });
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
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al conectar");
      setSuccess(
        `Conectado: ${data.liveCount} canales en directo${data.vodCount ? ` y ${data.vodCount} películas` : ""} importados. La guía EPG del proveedor se está descargando en segundo plano.`,
      );
      setForm({ name: "", serverUrl: "", username: "", password: "", streamFormat: "m3u8", includeVod: false });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  async function resync(id: number) {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al sincronizar");
      setNotice(`Sincronizado: ${data.imported} nuevos, ${data.updated} actualizados, ${data.removed} eliminados.`);
      startTransition(() => router.refresh());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: number) {
    if (!confirm("¿Eliminar este proveedor junto con todos sus canales y su guía?")) return;
    setBusy(id);
    try {
      await fetch(`/api/providers/${id}`, { method: "DELETE" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-white/5 bg-surface-2/80 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <Server className="h-4 w-4 text-brand-2" /> Añadir otro proveedor
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-400">Nombre (opcional)</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mi proveedor" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-400">URL del servidor</span>
          <input
            value={form.serverUrl}
            onChange={(e) => setForm({ ...form, serverUrl: e.target.value })}
            placeholder="http://servidor.com:8080"
            required
            className={cn(inputCls, "font-mono text-xs")}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-400">Usuario</span>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-400">Contraseña</span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              autoComplete="new-password"
              className={inputCls}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-400">Formato de stream</span>
            <select value={form.streamFormat} onChange={(e) => setForm({ ...form, streamFormat: e.target.value })} className={inputCls}>
              <option value="m3u8">HLS (.m3u8) · recomendado</option>
              <option value="ts">MPEG-TS (.ts)</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2.5 text-sm text-slate-300">
            <input type="checkbox" checked={form.includeVod} onChange={(e) => setForm({ ...form, includeVod: e.target.checked })} className="h-4 w-4 accent-brand" />
            Incluir películas (VOD)
          </label>
        </div>

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
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
          {loading ? "Conectando y descargando catálogo…" : "Conectar e importar"}
        </button>
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Las credenciales se guardan en tu base de datos para poder resincronizar el catálogo y descargar la guía
          EPG (xmltv.php) del proveedor. Compatible con la API estándar de Xtream Codes / XUI.
        </p>
      </form>

      <div className="rounded-2xl border border-white/5 bg-surface-2/80">
        <div className="border-b border-white/5 px-5 py-4">
          <h3 className="font-semibold text-white">Proveedores conectados</h3>
          <p className="text-xs text-slate-500">{providers.length === 0 ? "Ninguno todavía" : `${providers.length} proveedor(es)`}</p>
          {notice && <p className="mt-2 text-xs text-brand-2">{notice}</p>}
        </div>
        {providers.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Conecta tu primer proveedor para ver aquí su estado.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {providers.map((p) => {
              const expired = p.expiresAt ? new Date(p.expiresAt).getTime() < Date.now() : false;
              return (
                <li key={p.id} className="space-y-2 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-white">
                        {p.name}
                        {p.isPrimary && (
                          <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-brand-2 uppercase">
                            Cuenta de acceso
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase",
                            p.lastError
                              ? "bg-red-500/15 text-red-300"
                              : expired
                                ? "bg-amber-500/15 text-amber-200"
                                : "bg-emerald-500/15 text-emerald-300",
                          )}
                        >
                          {p.lastError ? "Error" : expired ? "Caducado" : (p.status ?? "Activo")}
                        </span>
                      </p>
                      <p className="truncate font-mono text-xs text-slate-500">
                        {p.serverUrl} · {p.username}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {p.expiresAt ? (
                          <>
                            Caduca: <TimeText date={p.expiresAt} mode="datetime" />
                          </>
                        ) : (
                          "Sin fecha de caducidad"
                        )}
                        {p.maxConnections ? ` · ${p.maxConnections} conexión(es)` : ""}
                        {p.lastSyncedAt ? (
                          <>
                            {" · sincronizado "}
                            <TimeText date={p.lastSyncedAt} mode="datetime" />
                          </>
                        ) : null}
                      </p>
                      {p.lastError && <p className="mt-1 text-xs text-red-300">{p.lastError}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {p.playlistId && (
                        <Link href={`/?playlist=${p.playlistId}`} className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 hover:bg-white/10">
                          Ver canales
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => resync(p.id)}
                        disabled={busy === p.id}
                        className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
                        title="Resincronizar"
                        aria-label="Resincronizar"
                      >
                        {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      </button>
                      {!p.isPrimary && (
                        <button
                          type="button"
                          onClick={() => remove(p.id)}
                          disabled={busy === p.id}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                          title="Eliminar"
                          aria-label="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
