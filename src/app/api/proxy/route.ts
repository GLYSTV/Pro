import { NextRequest } from "next/server";
import { apiUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

function proxied(absolute: string): string {
  return `/api/proxy?url=${encodeURIComponent(absolute)}`;
}

/**
 * Rewrites every URI inside an HLS manifest (segments, variant playlists,
 * encryption keys, init sections, media renditions) so they are fetched
 * through this proxy as well.
 */
function rewriteManifest(text: string, baseUrl: string): string {
  const resolve = (ref: string) => {
    try {
      return proxied(new URL(ref, baseUrl).toString());
    } catch {
      return ref;
    }
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // Tags that carry URI="..." attributes
        if (/^#EXT-X-(KEY|MAP|MEDIA|I-FRAME-STREAM-INF|SESSION-KEY|PART|PRELOAD-HINT|RENDITION-REPORT)/i.test(trimmed)) {
          return trimmed.replace(/URI="([^"]+)"/gi, (_m, uri: string) => `URI="${resolve(uri)}"`);
        }
        return line;
      }
      return resolve(trimmed);
    })
    .join("\n");
}

export async function GET(req: NextRequest) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;
  const target = req.nextUrl.searchParams.get("url");
  if (!target) return new Response("Falta el parámetro url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("URL inválida", { status: 400 });
  }
  if (!/^https?:$/.test(parsed.protocol) || BLOCKED_HOSTS.test(parsed.hostname)) {
    return new Response("Destino no permitido", { status: 403 });
  }

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*",
  };
  const range = req.headers.get("range");
  if (range) headers.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error de red";
    return new Response(`No se pudo contactar con el origen: ${message}`, { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`El origen respondió ${upstream.status}`, { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const finalUrl = upstream.url || parsed.toString();
  const looksLikePlaylist =
    /mpegurl|x-mpegURL|vnd\.apple\.mpegurl/i.test(contentType) ||
    /\.m3u8?(\?|$)/i.test(new URL(finalUrl).pathname);

  if (looksLikePlaylist) {
    const text = await upstream.text();
    if (!text.trimStart().startsWith("#EXTM3U")) {
      return new Response("El origen no devolvió un manifiesto HLS válido", { status: 502 });
    }
    return new Response(rewriteManifest(text, finalUrl), {
      status: 200,
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  }

  const passthrough = new Headers();
  passthrough.set("content-type", contentType || "application/octet-stream");
  passthrough.set("cache-control", "no-store");
  passthrough.set("access-control-allow-origin", "*");
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) passthrough.set(h, v);
  }

  return new Response(upstream.body, { status: upstream.status, headers: passthrough });
}
