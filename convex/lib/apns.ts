// Apple Push Notification service (APNs) for the iPhone and iPad app: whether it's set up here, what a
// notification carries, and what to do with Apple's answer. No Node APIs, so mutations and queries can use
// it; the sending itself (HTTP/2, the signed JWT) is in apnsSend.ts and lib/apnsHttp2.ts, lib/apnsJwt.ts.
//
// Environment (Convex): APNS_KEY_ID and APNS_TEAM_ID (from the developer account), APNS_KEY (the .p8 key's
// contents), APNS_BUNDLE_ID (com.folevi.ios) and APNS_ENV ("production", or "sandbox" for a deployment
// that only Debug builds use). Without the first four nothing is sent and the iOS app hides the option.
import { v } from "convex/values";

/** The APNs settings, or null when push to the iOS app isn't set up on this deployment. */
export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** The .p8 key as PEM (escaped newlines and a bare base64 body are accepted too). */
  key: string;
  bundleId: string;
  /** For a token registered without saying which environment it's from. */
  environment: ApnsEnvironment;
}

export type ApnsEnvironment = "sandbox" | "production";

const set = (v: string | undefined) => (v && v.trim() && v.trim() !== "none" ? v.trim() : null);

export function apnsConfig(env: Record<string, string | undefined> = process.env): ApnsConfig | null {
  const keyId = set(env.APNS_KEY_ID);
  const teamId = set(env.APNS_TEAM_ID);
  const raw = set(env.APNS_KEY);
  const bundleId = set(env.APNS_BUNDLE_ID);
  if (!keyId || !teamId || !raw || !bundleId) return null;
  return { keyId, teamId, key: pemOf(raw), bundleId, environment: env.APNS_ENV?.trim() === "sandbox" ? "sandbox" : "production" };
}

/** Which of the APNs variables are set: none, some (a mistake worth a warning) or all. */
export function apnsSetup(env: Record<string, string | undefined> = process.env): "none" | "partial" | "complete" {
  const n = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY", "APNS_BUNDLE_ID"].filter((k) => set(env[k])).length;
  return n === 0 ? "none" : n === 4 ? "complete" : "partial";
}

/** The key as PEM: pasted as is, with "\n" written out, or just the base64 between the PEM lines. */
export function pemOf(raw: string): string {
  const text = raw.replace(/\\n/g, "\n").trim();
  if (text.includes("-----BEGIN")) return text;
  const body = text.replace(/\s+/g, "");
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? body}\n-----END PRIVATE KEY-----`;
}

export const apnsHost = (environment: ApnsEnvironment) => (environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com");

/** A device token as the app sends it: hex (32 bytes today; Apple may make them longer). */
export const APNS_TOKEN_RE = /^[0-9a-f]{64,200}$/;

// ---------------------------------------------------------------- what's sent

/** The iOS app's notification categories (apps/ios Native/PushNotifications.swift registers the same). */
export const APNS_CATEGORY = { reminder: "REMINDER", mention: "MENTION" } as const;

export type ApnsKind = "reminder" | "mention" | "routine";

export interface ApnsMessage {
  kind: ApnsKind;
  title: string;
  body?: string;
  /** Where tapping it goes in the app: "/d/<note id>#block-<block id>". */
  path: string;
  /** The note it's about: notifications for one note are grouped together. */
  threadId?: string;
  /** A reminder's task (its block id): what the notification's Done and Snooze change through the REST API. */
  taskId?: string;
  /** Replaces an earlier notification with the same id (the same reminder again). At most 64 bytes. */
  collapseId?: string;
}

export const vApnsMessage = v.object({
  kind: v.union(v.literal("reminder"), v.literal("mention"), v.literal("routine")),
  title: v.string(),
  body: v.optional(v.string()),
  path: v.string(),
  threadId: v.optional(v.string()),
  taskId: v.optional(v.string()),
  collapseId: v.optional(v.string()),
});

/**
 * The JSON Apple delivers. Follows the web push policy: a reminder carries its to-do line and the note's
 * title; anything else only who did what and where. The app reads `path`, `kind` and `taskId`.
 */
export function apnsPayload(message: ApnsMessage, badge: number): Record<string, unknown> {
  const category = message.kind === "reminder" ? APNS_CATEGORY.reminder : message.kind === "mention" ? APNS_CATEGORY.mention : undefined;
  const alert: Record<string, string> = { title: message.title.slice(0, 120) };
  if (message.body) alert.body = message.body.slice(0, 240);
  return {
    aps: {
      alert,
      sound: "default",
      badge: Math.max(0, Math.min(badge, 99_999)),
      ...(message.threadId ? { "thread-id": message.threadId } : {}),
      ...(category ? { category } : {}),
      "mutable-content": 1,
    },
    kind: message.kind,
    path: appPath(message.path),
    ...(message.taskId ? { taskId: message.taskId } : {}),
  };
}

/** A path inside the app ("/d/ID#block-X"), from a path or a full link; anything else is the notes list. */
export function appPath(pathOrUrl: string): string {
  let path = pathOrUrl;
  if (/^https?:\/\//.test(pathOrUrl)) {
    try {
      const u = new URL(pathOrUrl);
      path = `${u.pathname}${u.hash}`;
    } catch {
      return "/documents";
    }
  }
  return /^\/[A-Za-z0-9/_#-]{0,200}$/.test(path) && !path.startsWith("//") ? path : "/documents";
}

/** The request headers for one notification (the JWT is added by the sender). */
export function apnsHeaders(config: ApnsConfig, message: ApnsMessage, now = Date.now()): Record<string, string> {
  const headers: Record<string, string> = {
    "apns-push-type": "alert",
    "apns-topic": config.bundleId,
    "apns-priority": "10",
    // Like web push's TTL: an hour late is still worth showing, later than that isn't.
    "apns-expiration": String(Math.floor(now / 1000) + 60 * 60),
  };
  if (message.collapseId) headers["apns-collapse-id"] = message.collapseId.slice(0, 64);
  return headers;
}

// ---------------------------------------------------------------- Apple's answer

/** What one attempt came to. Status 0 is no answer at all (no connection, a timeout). */
export interface ApnsAnswer {
  status: number;
  reason?: string;
}

export type ApnsOutcome = "sent" | "gone" | "retry" | "refresh" | "failed";

/**
 * 200 sent. 410 (Unregistered), BadDeviceToken and DeviceTokenNotForTopic: the token is no good, it goes.
 * 429 and 5xx (and no answer): tried again after a pause. ExpiredProviderToken: a fresh JWT, then again.
 * Anything else (a payload or key problem) isn't going to get better by trying again.
 */
export function apnsOutcome(answer: ApnsAnswer): ApnsOutcome {
  const { status, reason } = answer;
  if (status === 200) return "sent";
  if (status === 410 || reason === "Unregistered" || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") return "gone";
  if (status === 403 && reason === "ExpiredProviderToken") return "refresh";
  if (status === 0 || status === 429 || status >= 500) return "retry";
  return "failed";
}

/** Pauses before the second and third tries. */
export const APNS_RETRY_DELAYS_MS = [1_000, 4_000];

/**
 * One notification to one device, tried up to three times (APNS_RETRY_DELAYS_MS) when Apple is busy or
 * unreachable, and once more with a fresh JWT when Apple says it expired.
 */
export async function deliverWithRetry(
  attempt: (freshJwt: boolean) => Promise<ApnsAnswer>,
  sleep: (ms: number) => Promise<void>,
  delays: readonly number[] = APNS_RETRY_DELAYS_MS,
): Promise<{ outcome: "sent" | "gone" | "failed"; attempts: number; last: ApnsAnswer }> {
  let attempts = 0;
  let retries = 0;
  let refreshed = false;
  let fresh = false;
  for (;;) {
    let answer: ApnsAnswer;
    try {
      answer = await attempt(fresh);
    } catch {
      answer = { status: 0 };
    }
    attempts++;
    fresh = false;
    const outcome = apnsOutcome(answer);
    if (outcome === "sent" || outcome === "gone" || outcome === "failed") return { outcome, attempts, last: answer };
    if (outcome === "refresh") {
      if (refreshed) return { outcome: "failed", attempts, last: answer };
      refreshed = fresh = true;
      continue;
    }
    if (retries >= delays.length) return { outcome: "failed", attempts, last: answer };
    await sleep(delays[retries]!);
    retries++;
  }
}
