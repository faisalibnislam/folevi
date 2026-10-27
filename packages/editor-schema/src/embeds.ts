// Embeds: a YouTube, Vimeo or Loom video, a Figma file or a Google Map shown in the note. Only the page
// address is stored (the embed block's `url`); the frame's address is always built here from what's
// parsed out of it, so nothing a person types ever becomes an iframe src as is, and only these hosts are
// framed (apps/web's CSP frame-src lists the same ones: EMBED_FRAME_ORIGINS).

import type { EmbedProvider } from "./generated/schema";

export interface Embed {
  provider: EmbedProvider;
  /** The iframe's address. */
  src: string;
  /** Width over height. */
  aspect: number;
}

export const EMBED_PROVIDER_LABEL: Record<EmbedProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  loom: "Loom",
  figma: "Figma",
  googleMaps: "Google Maps",
};

/** Every origin an embed frame may load, for the Content Security Policy's frame-src. */
export const EMBED_FRAME_ORIGINS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://www.loom.com", "https://www.figma.com", "https://maps.google.com"] as const;

const VIDEO = 16 / 9;

function parse(raw: string): URL | null {
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

const hostIs = (url: URL, ...hosts: string[]) => {
  const h = url.hostname.toLowerCase().replace(/^www\./, "");
  return hosts.includes(h);
};

/** "1h2m3s", "90s" or "90" as seconds. */
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

function youtube(url: URL): Embed | null {
  let id: string | null;
  if (hostIs(url, "youtu.be")) id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (hostIs(url, "youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com")) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null;
  } else return null;
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`, aspect: VIDEO };
}

function vimeo(url: URL): Embed | null {
  let m: RegExpExecArray | null;
  if (hostIs(url, "vimeo.com")) m = /^\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/|video\/)?(\d{5,12})(?:\/([0-9a-f]{6,20}))?\/?$/i.exec(url.pathname);
  else if (hostIs(url, "player.vimeo.com")) m = /^\/video\/(\d{5,12})\/?$/.exec(url.pathname);
  else return null;
  if (!m) return null;
  const hash = m[2] ?? url.searchParams.get("h");
  const params = new URLSearchParams({ dnt: "1" });
  if (hash && /^[0-9a-f]{6,20}$/i.test(hash)) params.set("h", hash);
  return { provider: "vimeo", src: `https://player.vimeo.com/video/${m[1]}?${params}`, aspect: VIDEO };
}

function loom(url: URL): Embed | null {
  if (!hostIs(url, "loom.com")) return null;
  const id = /^\/(?:share|embed)\/([0-9a-f]{32})\/?$/i.exec(url.pathname)?.[1];
  return id ? { provider: "loom", src: `https://www.loom.com/embed/${id}`, aspect: VIDEO } : null;
}

function figma(url: URL): Embed | null {
  if (!hostIs(url, "figma.com")) return null;
  const m = /^\/(file|design|proto|board|slides|deck)\/([A-Za-z0-9]{10,64})(\/[^?#]*)?$/.exec(url.pathname);
  if (!m) return null;
  // Figma's embed takes the file's own address; only the parts that pick a frame are kept.
  const page = new URL(`https://www.figma.com/${m[1]}/${m[2]}${(m[3] ?? "").replace(/[^A-Za-z0-9/_-]/g, "")}`);
  for (const key of ["node-id", "page-id", "starting-point-node-id"]) {
    const v = url.searchParams.get(key);
    if (v && /^[0-9:-]{1,40}$/.test(v)) page.searchParams.set(key, v);
  }
  return { provider: "figma", src: `https://www.figma.com/embed?embed_host=folevi&url=${encodeURIComponent(page.toString())}`, aspect: VIDEO };
}

function googleMaps(url: URL): Embed | null {
  const host = url.hostname.toLowerCase();
  const isMaps = (/^(www\.)?google\.[a-z.]{2,6}$/.test(host) && url.pathname.startsWith("/maps")) || /^maps\.google\.[a-z.]{2,6}$/.test(host);
  if (!isMaps) return null;
  let query: string | null = url.searchParams.get("q") ?? url.searchParams.get("query");
  let zoom: number | null = null;
  const at = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d{1,2}(?:\.\d+)?)z)?/.exec(url.pathname);
  if (at) zoom = at[3] ? Math.round(Number(at[3])) : null;
  const place = /\/maps\/(?:place|search)\/([^/@]+)/.exec(url.pathname)?.[1];
  if (!query && place) query = decodeURIComponent(place.replace(/\+/g, " "));
  if (!query && at) query = `${at[1]},${at[2]}`;
  if (!query) return null;
  query = query.trim().slice(0, 300);
  if (!query) return null;
  const params = new URLSearchParams({ q: query, output: "embed" });
  if (zoom && zoom >= 1 && zoom <= 21) params.set("z", String(zoom));
  return { provider: "googleMaps", src: `https://maps.google.com/maps?${params}`, aspect: 4 / 3 };
}

/** The embed for a page address, or null when it isn't one Folevi can show. */
export function embedFor(raw: string): Embed | null {
  const url = parse(raw);
  if (!url) return null;
  return youtube(url) ?? vimeo(url) ?? loom(url) ?? figma(url) ?? googleMaps(url);
}

/** Why an address can't be embedded, as a sentence to show (null when it can). */
export function embedProblem(raw: string): string | null {
  if (embedFor(raw)) return null;
  const url = parse(raw);
  if (url && hostIs(url, "maps.app.goo.gl", "goo.gl")) return "Short map links can't be shown. Open the link and copy the full Google Maps address.";
  return "That address can't be embedded. Paste a YouTube, Vimeo, Loom, Figma or Google Maps link.";
}
