import { eq } from "drizzle-orm";
import { db } from "@/db";
import { epgSources, playlists, providers, type Provider } from "@/db/schema";
import { importEntries, pruneEmptyCustomCategories } from "@/lib/import";
import { fetchCatalog, normalizeServerUrl, parseExpiry, xmltvUrl } from "@/lib/xtream";

export interface ProviderSyncResult {
  provider: Provider;
  liveCount: number;
  vodCount: number;
  imported: number;
  updated: number;
  removed: number;
  epgSourceId: number | null;
}

/** Fetches the Xtream catalogue and (re)imports it as the provider's playlist. */
export async function syncProvider(provider: Provider): Promise<ProviderSyncResult> {
  if (provider.userId == null) throw new Error("El proveedor no pertenece a ninguna cuenta");
  const userId = provider.userId;
  try {
    const catalog = await fetchCatalog({
      serverUrl: provider.serverUrl,
      username: provider.username,
      password: provider.password,
      streamFormat: provider.streamFormat,
      includeVod: provider.includeVod,
    });

    const result = await importEntries(catalog.entries, {
      userId,
      name: provider.name,
      sourceUrl: normalizeServerUrl(provider.serverUrl),
      kind: "xtream",
      playlistId: provider.playlistId ?? undefined,
    });
    await db.update(playlists).set({ name: provider.name, kind: "xtream" }).where(eq(playlists.id, result.playlistId));

    // Keep an XMLTV source pointing at the provider's EPG endpoint.
    const epgUrl = xmltvUrl({ serverUrl: provider.serverUrl, username: provider.username, password: provider.password });
    let epgSourceId = provider.epgSourceId ?? null;
    if (epgSourceId) {
      const [existing] = await db.select({ id: epgSources.id }).from(epgSources).where(eq(epgSources.id, epgSourceId)).limit(1);
      if (!existing) epgSourceId = null;
      else await db.update(epgSources).set({ url: epgUrl, name: `EPG · ${provider.name}` }).where(eq(epgSources.id, epgSourceId));
    }
    if (!epgSourceId) {
      const [created] = await db
        .insert(epgSources)
        .values({ userId, name: `EPG · ${provider.name}`, url: epgUrl })
        .returning();
      epgSourceId = created.id;
    }

    const info = catalog.info.user_info ?? {};
    const [updatedProvider] = await db
      .update(providers)
      .set({
        playlistId: result.playlistId,
        epgSourceId,
        status: info.status ? String(info.status) : "Active",
        expiresAt: parseExpiry(info.exp_date),
        maxConnections: info.max_connections != null ? Number(info.max_connections) || null : null,
        lastSyncedAt: new Date(),
        lastError: null,
      })
      .where(eq(providers.id, provider.id))
      .returning();

    await pruneEmptyCustomCategories();

    return {
      provider: updatedProvider,
      liveCount: catalog.liveCount,
      vodCount: catalog.vodCount,
      imported: result.imported,
      updated: result.updated,
      removed: result.removed,
      epgSourceId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(providers).set({ lastError: message.slice(0, 500) }).where(eq(providers.id, provider.id));
    throw err;
  }
}

export function maskProvider(p: Provider) {
  return { ...p, password: "••••••••" };
}
