// The messages between the popup and the background service worker. The service worker does everything
// that has to outlive the popup (signing in in its own window, saving a clip); the popup reads the page
// and shows the result.
import type { Clip } from "./note";
import type { Place } from "./mcp";

export type ExtractMode = "article" | "selection" | "link";

/** What the injected extractor returns from the page. */
export interface Extracted {
  url: string;
  title: string;
  markdown: string;
  byline: string | null;
  siteName: string | null;
  /** Whether the person has text selected on the page. */
  hasSelection: boolean;
  /** False when Readability found no article and the page's main text was used. */
  readable: boolean;
}

export interface LastClip {
  ok: boolean;
  title: string;
  url?: string;
  place?: string;
  error?: string;
  at: number;
}

export type Request =
  | { type: "state" }
  | { type: "signIn" }
  | { type: "signOut" }
  | { type: "places" }
  | { type: "save"; clip: Clip; place?: string };

export interface StateResponse {
  signedIn: boolean;
  lastPlace: string | null;
  lastClip: LastClip | null;
}

export type Response<T> = { ok: true; value: T } | { ok: false; error: string; signedOut?: boolean };

export type PlacesResponse = Place[];
export type SaveResponse = { noteId: string; title: string; place: string; url: string };
