// Foli AI answers being written, in local mode (convex/ai.ts's aiStreams rows): the text so far and its state,
// kept in memory in the window that hosts the library (never on disk) and read by `ai.stream` and
// `aiChat.streamText` through the `stream:<id>` key (volatile.ts). Stop (`ai.cancelStream`, `aiChat.stop`)
// aborts the model call at once instead of waiting for its next write.
import { ulid } from "@folevi/editor-schema";
import { touchVolatile } from "../volatile";

export type StreamStatus = "pending" | "streaming" | "done" | "error" | "cancelled";

interface Stream {
  text: string;
  status: StreamStatus;
  updatedAt: number;
  abort: AbortController;
}

/** How long a finished answer stays readable (the server drops its rows after five minutes). */
const KEEP_MS = 5 * 60_000;
/** The most text a stream holds (the server's cap). */
export const MAX_STREAM_TEXT = 60_000;

const streams = new Map<string, Stream>();

const key = (id: string) => `stream:${id}`;

function sweep(now: number) {
  for (const [id, s] of streams) if (s.status !== "pending" && s.status !== "streaming" && now - s.updatedAt > KEEP_MS) streams.delete(id);
  // Anything older than an hour goes, finished or not (a call that never came back).
  for (const [id, s] of streams) if (now - s.updatedAt > 60 * 60_000) streams.delete(id);
}

/** A new, empty stream (ai.startStream). */
export function createStream(now = Date.now()): string {
  sweep(now);
  const id = `st_${ulid()}`;
  streams.set(id, { text: "", status: "pending", updatedAt: now, abort: new AbortController() });
  return id;
}

/** What a reader sees (ai.stream), or null when there's no such stream. */
export function readStream(id: string): { text: string; status: StreamStatus } | null {
  const s = streams.get(id);
  return s ? { text: s.text, status: s.status } : null;
}

/** Starts writing into a pending stream: its abort signal, or null when it's gone or already used. */
export function claimStream(id: string): AbortSignal | null {
  const s = streams.get(id);
  if (!s || s.status !== "pending") return null;
  s.status = "streaming";
  s.updatedAt = Date.now();
  touchVolatile(key(id));
  return s.abort.signal;
}

/** The text so far; false once the person pressed Stop (or the stream is gone). */
export function writeStream(id: string, text: string, status?: "done" | "error"): boolean {
  const s = streams.get(id);
  if (!s || s.status === "cancelled") return false;
  s.text = text.slice(0, MAX_STREAM_TEXT);
  s.status = status ?? "streaming";
  s.updatedAt = Date.now();
  touchVolatile(key(id));
  return true;
}

/** Stop: marks it cancelled and stops the model call. */
export function cancelStream(id: string): void {
  const s = streams.get(id);
  if (!s || (s.status !== "pending" && s.status !== "streaming")) return;
  s.status = "cancelled";
  s.updatedAt = Date.now();
  s.abort.abort();
  touchVolatile(key(id));
}

/** Forgets a stream (a chat answer that settled). */
export function dropStream(id: string): void {
  if (streams.delete(id)) touchVolatile(key(id));
}

export const streamKey = key;

/** Tests. */
export function resetStreams(): void {
  streams.clear();
}
