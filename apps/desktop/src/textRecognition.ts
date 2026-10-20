// Search in files (docs/ARCHITECTURE.md, "Search in files"): the words in an image, read on this Mac by
// folevi-text (native/recognize-text.swift, Apple's Vision), for the page to save as the image's searchable
// text. The page sends the image's bytes (desktop:recognize-text); the helper gets them on stdin and answers
// on stdout. One image at a time, a size limit, and a time limit after which the helper is stopped.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/** The most bytes an image may have (a camera photo is a few MB). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** How long the helper may take for one image. */
export const RECOGNIZE_TIMEOUT_MS = 30_000;
/** The most characters of text kept from one image. */
const MAX_TEXT = 100_000;

/** Bytes from the page, checked: a non-empty byte array within the size limit, else null. */
export function imageBytes(input: unknown): Uint8Array | null {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > MAX_IMAGE_BYTES) return null;
  return input;
}

/** The helper's answer: its text, or null when it didn't read the image. */
export function parseAnswer(stdout: string): { text: string } | null {
  try {
    const out = JSON.parse(stdout) as unknown;
    if (!out || typeof out !== "object" || typeof (out as { text?: unknown }).text !== "string") return null;
    return { text: (out as { text: string }).text.slice(0, MAX_TEXT) };
  } catch {
    return null;
  }
}

/** Runs the helper at `helper` on one image. Null when it's missing, fails, or takes too long. */
export function runHelper(helper: string, bytes: Uint8Array, opts: { handwriting?: boolean; timeoutMs?: number } = {}): Promise<{ text: string } | null> {
  if (!existsSync(helper)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn(helper, opts.handwriting ? ["--handwriting"] : [], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    let done = false;
    const finish = (value: { text: string } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, opts.timeoutMs ?? RECOGNIZE_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.length > MAX_TEXT * 8) {
        child.kill("SIGKILL");
        finish(null);
      }
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? parseAnswer(out) : null));
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
}

/** One image at a time: each call waits for the one before. */
export function oneAtATime<A extends unknown[], R>(work: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let last: Promise<unknown> = Promise.resolve();
  return (...args: A) => {
    const next = last.then(() => work(...args));
    last = next.catch(() => undefined);
    return next;
  };
}
