// Errors the local backend throws, shaped like the server's (convex/lib/errors.ts), so the app's error
// handling (`error.data.code`) reads both the same way.
import { ConvexError } from "convex/values";
import type { ErrorCode } from "@convex/lib/errors";

export function fail(code: ErrorCode, message?: string, extra?: Record<string, string | number | boolean>): never {
  throw new ConvexError({ code, message: message ?? code, ...extra });
}

/** A function local mode doesn't have (not ported yet, or hidden behind a capability). */
export function localUnsupported(name: string, hidden?: string): ConvexError<{ code: "local_unsupported"; message: string; fn: string; capability?: string }> {
  return new ConvexError({
    code: "local_unsupported" as const,
    message: hidden ? `${name} isn't available on this device (${hidden}).` : `${name} isn't available in local mode yet.`,
    fn: name,
    ...(hidden ? { capability: hidden } : {}),
  });
}

/** The ConvexError's code, if it's one. */
export function errorCode(e: unknown): string | undefined {
  return e instanceof ConvexError ? (e.data as { code?: string } | undefined)?.code : undefined;
}
