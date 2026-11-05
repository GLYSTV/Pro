import type { M3UEntry } from "@/lib/m3u";

export interface XtreamUserInfo {
  auth?: number | string;
  status?: string;
  exp_date?: string | number | null;
  max_connections?: string | number;
  active_cons?: string | number;
  username?: string;
  message?: string;
}

export interface XtreamServerInfo {
  url?: string;
  port?: string | number;
  https_port?: string | number;
  server_protocol?: string;
  timezone?: string;
}

export interface XtreamAuthResponse {
  user_info?: XtreamUserInfo;
  server_info?: XtreamServerInfo;
}

interface XtreamCategory {
  category_id: string | number;
  category_name: string;
}

interface XtreamLiveStream {
  num?: number;
  name: string;
  stream_id: number | string;
  stream_icon?: string | null;
  epg_channel_id?: string | null;
  category_id?: string | number | null;
}

interface XtreamVodStream {
  name: string;
  stream_id: number | string;
  stream_icon?: string | null;
  container_extension?: string | null;
  category_id?: string | number | null;
}

export interface XtreamCredentials {
  serverUrl: string;
  username: string;
  password: string;
  streamFormat?: string;
  includeVod?: boolean;
}

/** Normalises user input like `http://host:8080/get.php?...` into `http://host:8080`. */
export function normalizeServerUrl(input: string): string {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  const u = new URL(raw);
  let pathname = u.pathname.replace(/\/(player_api\.php|get\.php|xmltv\.php|panel_api\.php)$/i, "").replace(/\/+$/, "");
  if (pathname === "/") pathname = "";
  return `${u.protocol}//${u.host}${pathname}`;
}

async function fetchJson<T>(url: string, timeoutMs = 30000): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GLYSTV-PRO/1.0)", Accept: "application/json, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("El servidor no devolvió JSON válido (¿es realmente un panel Xtream Codes?)");
  }
}

export function apiUrl(creds: XtreamCredentials, action?: string, extra: Record<string, string> = {}) {
  const base = normalizeServerUrl(creds.serverUrl);
  const params = new URLSearchParams({ username: creds.username, password: creds.password, ...extra });
  if (action) params.set("action", action);
  return `${base}/player_api.php?${params.toString()}`;
}

export function xmltvUrl(creds: XtreamCredentials) {
  const base = normalizeServerUrl(creds.serverUrl);
  const params = new URLSearchParams({ username: creds.username, password: creds.password });
  return `${base}/xmltv.php?${params.toString()}`;
}

export async function authenticate(creds: XtreamCredentials): Promise<XtreamAuthResponse> {
  const data = await fetchJson<XtreamAuthResponse>(apiUrl(creds), 20000);
  const auth = data.user_info?.auth;
  if (auth === 0 || auth === "0" || (data.user_info && auth == null && !data.user_info.username)) {
    throw new Error(data.user_info?.message || "Credenciales rechazadas por el proveedor");
  }
  if (!data.user_info) throw new Error("Respuesta inesperada del proveedor");
  return data;
}

export function parseExpiry(value: string | number | null | undefined): Date | null {
  if (value == null || value === "" || value === "null") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

export interface XtreamCatalog {
  info: XtreamAuthResponse;
  entries: M3UEntry[];
  liveCount: number;
  vodCount: number;
}

/** Downloads categories + live (and optionally VOD) streams and turns them into playlist entries. */
export async function fetchCatalog(creds: XtreamCredentials): Promise<XtreamCatalog> {
  const info = await authenticate(creds);
  const base = normalizeServerUrl(creds.serverUrl);
  const format = creds.streamFormat === "ts" ? "ts" : "m3u8";
  const u = encodeURIComponent(creds.username);
  const p = encodeURIComponent(creds.password);

  const [liveCategories, liveStreams] = await Promise.all([
    fetchJson<XtreamCategory[]>(apiUrl(creds, "get_live_categories")).catch(() => [] as XtreamCategory[]),
    fetchJson<XtreamLiveStream[]>(apiUrl(creds, "get_live_streams"), 60000),
  ]);
  const liveCatName = new Map(
    (Array.isArray(liveCategories) ? liveCategories : []).map((c) => [String(c.category_id), c.category_name]),
  );

  const entries: M3UEntry[] = [];
  for (const s of Array.isArray(liveStreams) ? liveStreams : []) {
    if (!s || s.stream_id == null) continue;
    entries.push({
      name: String(s.name ?? `Canal ${s.stream_id}`).trim() || `Canal ${s.stream_id}`,
      url: `${base}/live/${u}/${p}/${s.stream_id}.${format}`,
      logo: s.stream_icon || undefined,
      group: (s.category_id != null && liveCatName.get(String(s.category_id))) || "Live",
      tvgId: s.epg_channel_id || undefined,
    });
  }
  const liveCount = entries.length;

  let vodCount = 0;
  if (creds.includeVod) {
    const [vodCategories, vodStreams] = await Promise.all([
      fetchJson<XtreamCategory[]>(apiUrl(creds, "get_vod_categories")).catch(() => [] as XtreamCategory[]),
      fetchJson<XtreamVodStream[]>(apiUrl(creds, "get_vod_streams"), 60000).catch(() => [] as XtreamVodStream[]),
    ]);
    const vodCatName = new Map(
      (Array.isArray(vodCategories) ? vodCategories : []).map((c) => [String(c.category_id), c.category_name]),
    );
    for (const s of (Array.isArray(vodStreams) ? vodStreams : []).slice(0, 3000)) {
      if (!s || s.stream_id == null) continue;
      const ext = (s.container_extension || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
      entries.push({
        name: String(s.name ?? `Película ${s.stream_id}`).trim(),
        url: `${base}/movie/${u}/${p}/${s.stream_id}.${ext}`,
        logo: s.stream_icon || undefined,
        group: `VOD · ${(s.category_id != null && vodCatName.get(String(s.category_id))) || "Películas"}`,
      });
      vodCount++;
    }
  }

  return { info, entries, liveCount, vodCount };
}
