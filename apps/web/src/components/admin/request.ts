import { ulid } from "@folevi/editor-schema";

let hashPromise: Promise<string | undefined> | null = null;

/**
 * A coarse, one-way fingerprint of the admin's client (user agent, language, time zone, screen) so
 * audit entries can be correlated per device without storing the raw values.
 */
export function clientHash(): Promise<string | undefined> {
  hashPromise ??= (async () => {
    try {
      const raw = [
        navigator.userAgent,
        navigator.language,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        `${window.screen.width}x${window.screen.height}`,
      ].join("|");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
    } catch {
      return undefined;
    }
  })();
  return hashPromise;
}

export function newRequestId(): string {
  return ulid();
}

/** Fields accepted by every sensitive admin mutation besides `reason`. */
export async function requestMeta(): Promise<{ requestId: string; clientHash?: string }> {
  const hash = await clientHash();
  return hash ? { requestId: newRequestId(), clientHash: hash } : { requestId: newRequestId() };
}
