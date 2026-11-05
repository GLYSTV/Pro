"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ChannelLogo } from "@/components/channel-logo";
import type { ChannelListItem } from "@/lib/channels";
import { cn, countryFlag } from "@/lib/utils";

interface CategoryOption {
  id: number;
  name: string;
}

interface FormState {
  name: string;
  streamUrl: string;
  logoUrl: string;
  categoryId: string;
  country: string;
  language: string;
  description: string;
}

const EMPTY: FormState = {
  name: "",
  streamUrl: "",
  logoUrl: "",
  categoryId: "",
  country: "",
  language: "",
  description: "",
};

const inputCls =
  "w-full rounded-xl border border-white/10 bg-surface-3 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand/60 focus:ring-2 focus:ring-brand/30 focus:outline-none";

export function ChannelManager({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState<ChannelListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ChannelListItem | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ all: "1", page: String(page), limit: "25" });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/channels?${params}`, { cache: "no-store" });
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPages(data.pages ?? 1);
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const refreshAll = () => {
    void load();
    startTransition(() => router.refresh());
  };

  function openNew() {
    setForm(EMPTY);
    setFormError(null);
    setEditing("new");
  }

  function openEdit(c: ChannelListItem) {
    setForm({
      name: c.name,
      streamUrl: c.streamUrl,
      logoUrl: c.logoUrl ?? "",
      categoryId: c.categoryId ? String(c.categoryId) : "",
      country: c.country ?? "",
      language: c.language ?? "",
      description: c.description ?? "",
    });
    setFormError(null);
    setEditing(c);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = { ...form, categoryId: form.categoryId ? Number(form.categoryId) : null };
      const res =
        editing === "new"
          ? await fetch("/api/channels", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/channels/${(editing as ChannelListItem).id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setEditing(null);
      setNotice(editing === "new" ? `Canal «${data.name}» creado` : `Canal «${data.name}» actualizado`);
      refreshAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: ChannelListItem) {
    setBusyId(c.id);
    try {
      await fetch(`/api/channels/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !c.isActive }),
      });
      refreshAll();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(c: ChannelListItem) {
    if (!confirm(`¿Eliminar el canal «${c.name}»?`)) return;
    setBusyId(c.id);
    try {
      await fetch(`/api/channels/${c.id}`, { method: "DELETE" });
      setNotice(`Canal «${c.name}» eliminado`);
      refreshAll();
    } finally {
      setBusyId(null);
    }
  }

  async function restoreSamples() {
    setBusyId(-1);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json();
      setNotice(
        data.channelsAdded > 0
          ? `Se añadieron ${data.channelsAdded} canales de demostración a tu catálogo`
          : "Los canales de demostración ya estaban en tu catálogo (se han actualizado)",
      );
      refreshAll();
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nombre…"
            className={cn(inputCls, "pl-10")}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={restoreSamples}
            disabled={busyId === -1}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white hover:bg-white/10 disabled:opacity-60"
          >
            {busyId === -1 ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Canales de demostración
          </button>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-brand/90"
          >
            <Plus className="h-4 w-4" /> Nuevo canal
          </button>
        </div>
      </div>

      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</p>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-surface-2/80">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-black/20 text-left text-xs tracking-wider text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 font-medium">Categoría</th>
                <th className="px-4 py-3 font-medium">Stream</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    No hay canales. Crea uno nuevo o importa una lista M3U.
                  </td>
                </tr>
              ) : (
                items.map((c) => (
                  <tr key={c.id} className={cn("transition hover:bg-white/[0.03]", !c.isActive && "opacity-60")}>
                    <td className="px-4 py-3 tabular-nums text-slate-500">{c.channelNumber ?? "·"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ChannelLogo name={c.name} logoUrl={c.logoUrl} className="h-9 w-12 shrink-0" textClassName="text-[10px]" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{c.name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {c.country ? `${countryFlag(c.country)} ${c.country}` : ""}
                            {c.language ? ` · ${c.language.toUpperCase()}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{c.categoryName ?? <span className="text-slate-600">—</span>}</td>
                    <td className="max-w-[260px] px-4 py-3">
                      <p className="truncate font-mono text-xs text-slate-400" title={c.streamUrl}>
                        {c.streamUrl}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          c.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-slate-400",
                        )}
                      >
                        {c.isActive ? "Activo" : "Oculto"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/watch/${c.id}`}
                          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                          title="Reproducir"
                        >
                          <Play className="h-4 w-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => toggleActive(c)}
                          disabled={busyId === c.id}
                          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                          title={c.isActive ? "Ocultar" : "Mostrar"}
                        >
                          {c.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c)}
                          disabled={busyId === c.id}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                          title="Eliminar"
                        >
                          {busyId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-3 text-xs text-slate-400">
          <span>
            {total} canales · página {page} de {pages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-40"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-40"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <form
            onSubmit={save}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-surface-2 p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{editing === "new" ? "Nuevo canal" : "Editar canal"}</h2>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-400">Nombre *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-400">URL del stream (HLS .m3u8, MP4…) *</span>
              <input
                value={form.streamUrl}
                onChange={(e) => setForm({ ...form, streamUrl: e.target.value })}
                required
                type="url"
                placeholder="https://…/index.m3u8"
                className={cn(inputCls, "font-mono text-xs")}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-400">URL del logo</span>
              <input
                value={form.logoUrl}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                type="url"
                placeholder="https://…/logo.png"
                className={cn(inputCls, "font-mono text-xs")}
              />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-3 block sm:col-span-1">
                <span className="mb-1.5 block text-xs font-medium text-slate-400">Categoría</span>
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className={inputCls}>
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-400">País (ISO)</span>
                <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="ES" maxLength={8} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-400">Idioma</span>
                <input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="es" maxLength={16} className={inputCls} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-400">Descripción</span>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className={inputCls} />
            </label>

            {formError && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/10">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing === "new" ? "Crear canal" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
