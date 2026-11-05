import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { Download, ListVideo } from "lucide-react";
import { db } from "@/db";
import { epgSources, playlists, providers } from "@/db/schema";
import { EpgManager } from "@/components/epg-manager";
import { PlaylistManager } from "@/components/playlist-manager";
import { ProviderManager } from "@/components/provider-manager";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fuentes" };

export default async function PlaylistsPage() {
  const { user } = await requireProfile();
  const [items, providerRows, epgRows] = await Promise.all([
    db.select().from(playlists).where(eq(playlists.userId, user.id)).orderBy(asc(playlists.createdAt)),
    db.select().from(providers).where(eq(providers.userId, user.id)).orderBy(asc(providers.createdAt)),
    db.select().from(epgSources).where(eq(epgSources.userId, user.id)).orderBy(asc(epgSources.createdAt)),
  ]);

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brand-2 uppercase">
            <ListVideo className="h-3.5 w-3.5" /> Fuentes de contenido
          </p>
          <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Listas, proveedores y EPG</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Tu proveedor de acceso se sincroniza automáticamente. Además puedes importar listas M3U, conectar otros
            proveedores Xtream Codes y añadir guías XMLTV. El catálogo se comparte entre los perfiles de la cuenta.
          </p>
        </div>
        <a
          href="/api/export"
          className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
        >
          <Download className="h-4 w-4" /> Exportar catálogo (.m3u)
        </a>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Listas M3U</h2>
        <PlaylistManager playlists={items} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Proveedores Xtream Codes</h2>
        <ProviderManager
          providers={providerRows.map((p) => ({
            id: p.id,
            name: p.name,
            serverUrl: p.serverUrl,
            username: p.username,
            streamFormat: p.streamFormat,
            includeVod: p.includeVod,
            isPrimary: p.isPrimary,
            playlistId: p.playlistId,
            status: p.status,
            expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
            maxConnections: p.maxConnections,
            lastSyncedAt: p.lastSyncedAt ? p.lastSyncedAt.toISOString() : null,
            lastError: p.lastError,
          }))}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Guía de programación (XMLTV)</h2>
        <EpgManager
          sources={epgRows.map((s) => ({
            id: s.id,
            name: s.name,
            url: s.url,
            lastFetchedAt: s.lastFetchedAt ? s.lastFetchedAt.toISOString() : null,
            channelCount: s.channelCount,
            programCount: s.programCount,
            lastError: s.lastError,
          }))}
        />
      </section>
    </div>
  );
}
