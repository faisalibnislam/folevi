// Large files for Gemini (docs/AI_ASSISTANT.md, "Attachments"): a recording too large to send inline goes
// through the Gemini Files API. It's uploaded in two requests (a resumable upload: start, then the bytes
// with "upload, finalize"), waited on until Google has processed it (state ACTIVE), referenced in requests
// as a `fileData` part, and deleted as soon as the work is done, however it ends (Google would otherwise
// keep it for 48 hours). Same key and header as lib/ai/gemini.ts. Only `fetch` leaves here, so tests stub it.
//
// Privacy: the bytes go to Google and nowhere else. Only sizes, states and statuses are logged.
import { fail } from "../errors";

const BASE = "https://generativelanguage.googleapis.com";
/** Where an upload may be sent: Google's own upload address, nothing a response could point elsewhere. */
const UPLOAD_HOST = "generativelanguage.googleapis.com";
/** A file's name as Google gives it ("files/abc123"), checked before it goes into an address. */
const FILE_NAME = /^files\/[a-z0-9-]{1,64}$/;

/** Starting an upload, polling and deleting each answer well within this. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Sending the bytes (a three-hour recording is about 90 MB). */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** How long Google may take to process a file before the request gives up. */
export const PROCESSING_TIMEOUT_MS = 2 * 60_000;
/** Waits between polls while the file is processed: quick at first, then every 2 s. */
const POLL_MS = [500, 1_000, 2_000];

const UNREACHABLE = "Foli AI couldn't be reached. Try again shortly.";

/** A file Gemini holds, as requests reference it. */
export interface GeminiFile {
  /** "files/abc123": for polling and deleting. */
  name: string;
  /** The address a `fileData` part points at. */
  uri: string;
  mimeType: string;
}

type FileJson = { name?: unknown; uri?: unknown; mimeType?: unknown; state?: unknown };

const keyOf = (): string => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) fail("maintenance", "Foli AI isn't set up on this server yet.");
  return key;
};

/** A fetch with a deadline; a timeout or network failure fails plainly (the event logged, never content). */
async function call(url: string, init: RequestInit, ms: number, event: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    console.warn(JSON.stringify({ event: "ai.file_error", step: event }));
    fail("maintenance", UNREACHABLE);
  } finally {
    clearTimeout(timer);
  }
}

/** A refused request, as the person reads it (429 is "busy", anything else "couldn't be reached"). */
function refused(step: string, status: number): never {
  console.warn(JSON.stringify({ event: "ai.file_error", step, status }));
  if (status === 429) fail("rate_limited", "The AI is busy right now. Try again in a minute.");
  fail("maintenance", UNREACHABLE);
}

/** A file from Google's JSON, checked (its name goes into addresses), with its processing state. */
function fileOf(json: FileJson | undefined, mimeType: string): GeminiFile & { state: string } {
  const name = typeof json?.name === "string" ? json.name : "";
  const uri = typeof json?.uri === "string" ? json.uri : "";
  if (!FILE_NAME.test(name) || !uri.startsWith(`${BASE}/`)) {
    console.warn(JSON.stringify({ event: "ai.file_error", step: "parse" }));
    fail("maintenance", UNREACHABLE);
  }
  return { name, uri, mimeType: typeof json?.mimeType === "string" && json.mimeType ? json.mimeType : mimeType, state: typeof json?.state === "string" ? json.state : "STATE_UNSPECIFIED" };
}

/**
 * Uploads bytes to the Files API (a resumable upload in two requests) and returns the file with its state.
 * A Blob straight from storage is sent as it is, so a large recording is never copied in memory here.
 */
export async function uploadFile(blob: Blob, o: { mimeType: string; displayName: string }): Promise<GeminiFile & { state: string }> {
  const key = keyOf();
  const start = await call(
    `${BASE}/upload/v1beta/files`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "content-type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(blob.size),
        "X-Goog-Upload-Header-Content-Type": o.mimeType,
      },
      body: JSON.stringify({ file: { display_name: o.displayName } }),
    },
    REQUEST_TIMEOUT_MS,
    "start",
  );
  if (!start.ok) refused("start", start.status);
  const uploadUrl = start.headers.get("x-goog-upload-url") ?? "";
  let target: URL | null;
  try {
    target = new URL(uploadUrl);
  } catch {
    target = null;
  }
  // The key goes along with the bytes, so the address must be Google's.
  if (!target || target.protocol !== "https:" || target.hostname !== UPLOAD_HOST) {
    console.warn(JSON.stringify({ event: "ai.file_error", step: "start", status: start.status, uploadUrl: Boolean(uploadUrl) }));
    fail("maintenance", UNREACHABLE);
  }
  const sent = await call(
    target.toString(),
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0" },
      body: blob,
    },
    UPLOAD_TIMEOUT_MS,
    "upload",
  );
  if (!sent.ok) refused("upload", sent.status);
  const json = (await sent.json().catch(() => null)) as { file?: FileJson } | null;
  const file = fileOf(json?.file, o.mimeType);
  console.log(JSON.stringify({ event: "ai.file_uploaded", bytes: blob.size, state: file.state }));
  return file;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until Google has processed an uploaded file (ACTIVE), polling for up to PROCESSING_TIMEOUT_MS.
 * A file that failed processing, or one still processing at the deadline, fails the request.
 */
export async function waitUntilActive(file: GeminiFile & { state: string }, timeoutMs = PROCESSING_TIMEOUT_MS): Promise<GeminiFile> {
  const key = keyOf();
  const deadline = Date.now() + timeoutMs;
  let state = file.state;
  for (let i = 0; state !== "ACTIVE"; i++) {
    if (state === "FAILED") {
      console.warn(JSON.stringify({ event: "ai.file_error", step: "processing", state }));
      fail("unsupported_file", "Foli AI couldn't read this recording.");
    }
    if (Date.now() >= deadline) {
      console.warn(JSON.stringify({ event: "ai.file_error", step: "processing", state, timedOut: true }));
      fail("maintenance", "The AI took too long to answer. Try again shortly.");
    }
    await sleep(POLL_MS[Math.min(i, POLL_MS.length - 1)]!);
    const res = await call(`${BASE}/v1beta/${file.name}`, { method: "GET", headers: { "x-goog-api-key": key } }, REQUEST_TIMEOUT_MS, "poll");
    if (!res.ok) refused("poll", res.status);
    state = fileOf((await res.json().catch(() => null)) as FileJson | undefined, file.mimeType).state;
  }
  return { name: file.name, uri: file.uri, mimeType: file.mimeType };
}

/** Deletes a file from the Files API. Best effort: a failure is logged (Google removes it after 48 hours). */
export async function deleteFile(name: string): Promise<void> {
  if (!FILE_NAME.test(name)) return;
  try {
    const res = await call(`${BASE}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": keyOf() } }, REQUEST_TIMEOUT_MS, "delete");
    if (!res.ok) console.warn(JSON.stringify({ event: "ai.file_error", step: "delete", status: res.status }));
  } catch {
    /* Logged by `call`; the file expires on its own. */
  }
}

/**
 * Uploads `blob`, waits until it's ready, runs `work` with it, and deletes it afterwards, whether the work
 * (or the wait) succeeded or not.
 */
export async function withGeminiFile<T>(blob: Blob, o: { mimeType: string; displayName: string }, work: (file: GeminiFile) => Promise<T>): Promise<T> {
  const uploaded = await uploadFile(blob, o);
  try {
    return await work(await waitUntilActive(uploaded));
  } finally {
    await deleteFile(uploaded.name);
  }
}
