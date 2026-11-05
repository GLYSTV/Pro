export interface M3UEntry {
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  language?: string;
  country?: string;
  description?: string;
}

const ATTR_REGEX = /([A-Za-z0-9_-]+)="([^"]*)"/g;

function parseAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of line.matchAll(ATTR_REGEX)) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
    return decodeURIComponent(last.replace(/\.(m3u8|m3u|mp4|ts|mpd)$/i, "")) || u.hostname;
  } catch {
    return url.slice(0, 60);
  }
}

/**
 * Parses an extended M3U / M3U8 playlist (the IPTV flavour with #EXTINF
 * attributes) into a flat list of entries.
 */
export function parseM3U(text: string): M3UEntry[] {
  const entries: M3UEntry[] = [];
  const lines = text.split(/\r?\n/);
  let pending: Omit<M3UEntry, "url"> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const info = line.replace(/^#EXTINF:\s*-?\d+(\.\d+)?\s*/i, "");
      const attrs = parseAttributes(info);
      const withoutAttrs = info.replace(ATTR_REGEX, "").trim();
      const commaIndex = withoutAttrs.indexOf(",");
      const title = (commaIndex >= 0 ? withoutAttrs.slice(commaIndex + 1) : withoutAttrs).trim();
      pending = {
        name: title || attrs["tvg-name"] || "",
        logo: attrs["tvg-logo"] || undefined,
        group: attrs["group-title"] || undefined,
        tvgId: attrs["tvg-id"] || undefined,
        language: attrs["tvg-language"] || undefined,
        country: attrs["tvg-country"] || undefined,
      };
      continue;
    }

    if (line.startsWith("#EXTGRP:")) {
      if (pending) pending.group = line.slice(8).trim() || pending.group;
      continue;
    }

    if (line.startsWith("#")) continue;

    if (!/^https?:\/\//i.test(line)) {
      // ignore local paths / unsupported protocols (rtmp, udp, ...)
      pending = null;
      continue;
    }

    if (pending) {
      entries.push({ ...pending, name: pending.name || nameFromUrl(line), url: line });
      pending = null;
    } else {
      entries.push({ name: nameFromUrl(line), url: line });
    }
  }

  return entries;
}

/** Maps common (mostly English) group titles to the app's built-in category slugs. */
export function mapGroupToSlug(group: string | undefined): string | null {
  if (!group) return null;
  const g = group.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/news|noticia|informaci/, "noticias"],
    [/sport|deporte|futbol|fútbol|soccer/, "deportes"],
    [/kid|infantil|animation|cartoon|children|niñ/, "infantil"],
    [/movie|cine|film|pelicul|pelícu/, "cine"],
    [/music|música|musica|radio/, "musica"],
    [/document|science|nature|history|educat|cultur/, "documentales"],
    [/entertain|entreten|lifestyle|comedy|series|variet|reality/, "entretenimiento"],
    [/legislat|parlament|government|gobierno|institu|public/, "institucional"],
    [/general|undefined|otros|misc|local|regional/, "generalista"],
    [/test|prueba|demo/, "pruebas"],
  ];
  for (const [re, slug] of rules) {
    if (re.test(g)) return slug;
  }
  return null;
}

export function buildM3U(
  items: Array<{
    name: string;
    streamUrl: string;
    logoUrl?: string | null;
    group?: string | null;
    tvgId?: string | null;
  }>,
): string {
  const lines = ["#EXTM3U"];
  for (const it of items) {
    const attrs = [
      `tvg-id="${(it.tvgId ?? "").replace(/"/g, "")}"`,
      `tvg-logo="${(it.logoUrl ?? "").replace(/"/g, "")}"`,
      `group-title="${(it.group ?? "").replace(/"/g, "")}"`,
    ].join(" ");
    lines.push(`#EXTINF:-1 ${attrs},${it.name}`);
    lines.push(it.streamUrl);
  }
  return lines.join("\n") + "\n";
}
