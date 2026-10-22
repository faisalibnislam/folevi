// Firebase Cloud Messaging (FCM) for Folevi for Android, next to APNs for the iPhone app (lib/apns.ts): whether
// it's set up here, what a notification carries, and what to do with Google's answer. No Node APIs, so mutations
// and queries can use it; the sending (OAuth with the service account, the HTTP v1 API) is in fcmSend.ts and
// lib/fcmAuth.ts.
//
// Environment (Convex, set by the owner; docs/ANDROID_PLAN.md "Notifications"): FCM_SERVICE_ACCOUNT, the
// Firebase project's service account key as JSON (project_id, client_email, private_key). FCM_PROJECT_ID
// overrides the project when it differs. Without it nothing is scheduled or sent and the Android app hides the
// option, as it does for APNs.
import { v } from "convex/values";

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  /** The service account's private key as PEM. */
  privateKey: string;
}

const set = (s: string | undefined) => (s && s.trim() && s.trim() !== "none" ? s.trim() : null);

export function fcmConfig(env: Record<string, string | undefined> = process.env): FcmConfig | null {
  const raw = set(env.FCM_SERVICE_ACCOUNT);
  if (!raw) return null;
  let account: { project_id?: unknown; client_email?: unknown; private_key?: unknown };
  try {
    account = JSON.parse(raw) as typeof account;
  } catch {
    return null;
  }
  const projectId = set(env.FCM_PROJECT_ID) ?? (typeof account.project_id === "string" ? account.project_id : null);
  const clientEmail = typeof account.client_email === "string" ? account.client_email : null;
  const privateKey = typeof account.private_key === "string" ? account.private_key.replace(/\\n/g, "\n") : null;
  if (!projectId || !/^[a-z0-9-]{4,40}$/.test(projectId) || !clientEmail || !privateKey || !privateKey.includes("PRIVATE KEY")) return null;
  return { projectId, clientEmail, privateKey };
}

/** Which of the FCM settings are set: none, some that don't make a config (worth a warning), or all. */
export function fcmSetup(env: Record<string, string | undefined> = process.env): "none" | "partial" | "complete" {
  if (!set(env.FCM_SERVICE_ACCOUNT)) return "none";
  return fcmConfig(env) ? "complete" : "partial";
}

/** A registration token as the Android app sends it (FCM tokens are about 160 characters of base64url and ":"). */
export const FCM_TOKEN_RE = /^[A-Za-z0-9_:-]{100,4096}$/;

export type FcmKind = "reminder" | "mention" | "routine";

export interface FcmMessage {
  kind: FcmKind;
  title: string;
  body?: string;
  /** Where tapping it goes in the app: "/d/<note id>#block-<block id>". */
  path: string;
  /** The note it's about: notifications for one note are grouped together. */
  threadId?: string;
  /** A reminder's task (its block id): what the notification's Done and Snooze change through the REST API. */
  taskId?: string;
  /** Replaces an earlier notification with the same key (the same reminder again). */
  collapseId?: string;
}

export const vFcmMessage = v.object({
  kind: v.union(v.literal("reminder"), v.literal("mention"), v.literal("routine")),
  title: v.string(),
  body: v.optional(v.string()),
  path: v.string(),
  threadId: v.optional(v.string()),
  taskId: v.optional(v.string()),
  collapseId: v.optional(v.string()),
});

/** A path inside the app ("/d/ID#block-X"); anything else is the notes list. */
export function fcmPath(path: string): string {
  return /^\/[A-Za-z0-9/_#-]{0,200}$/.test(path) && !path.startsWith("//") ? path : "/documents";
}

/**
 * The HTTP v1 message for one device. Data only, so the app draws the notification itself, with its actions
 * (Done and Snooze 1 hour on a reminder, Reply and Open on a mention) and in its own channels, whether it's
 * running or not. Follows the web push policy: a reminder carries its to-do line and the note's title, anything
 * else only who did what and where. High priority, an hour to live (as APNs' expiration and web push's TTL).
 */
export function fcmBody(token: string, message: FcmMessage, badge: number): Record<string, unknown> {
  const data: Record<string, string> = {
    kind: message.kind,
    title: message.title.slice(0, 120),
    path: fcmPath(message.path),
    badge: String(Math.max(0, Math.min(badge, 99_999))),
  };
  if (message.body) data.body = message.body.slice(0, 240);
  if (message.threadId) data.threadId = message.threadId;
  if (message.taskId) data.taskId = message.taskId;
  if (message.collapseId) data.collapseId = message.collapseId.slice(0, 64);
  return {
    message: {
      token,
      data,
      android: { priority: "HIGH", ttl: "3600s", ...(message.collapseId ? { collapse_key: message.collapseId.slice(0, 64) } : {}) },
    },
  };
}

// ---------------------------------------------------------------- Google's answer

/** What one attempt came to. Status 0 is no answer at all. `code` is FCM's error code (UNREGISTERED…). */
export interface FcmAnswer {
  status: number;
  code?: string;
}

export type FcmOutcome = "sent" | "gone" | "retry" | "refresh" | "failed";

/**
 * 200 sent. UNREGISTERED (404) or INVALID_ARGUMENT about the token (400), SENDER_ID_MISMATCH: the token is no good,
 * it goes. 401: a fresh access token, then again. 429, 5xx, UNAVAILABLE, INTERNAL and no answer: tried again after
 * a pause. Anything else won't get better by trying.
 */
export function fcmOutcome(answer: FcmAnswer): FcmOutcome {
  const { status, code } = answer;
  if (status === 200) return "sent";
  if (status === 404 || code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH" || (status === 400 && code === "INVALID_ARGUMENT")) return "gone";
  if (status === 401) return "refresh";
  if (status === 0 || status === 429 || status >= 500 || code === "UNAVAILABLE" || code === "INTERNAL" || code === "QUOTA_EXCEEDED") return "retry";
  return "failed";
}

/** FCM's error code from an error answer's body (google.rpc.Status with FcmError details). */
export function fcmErrorCode(body: string): string | undefined {
  try {
    const e = (JSON.parse(body) as { error?: { status?: string; details?: { errorCode?: string }[] } }).error;
    return e?.details?.find((d) => typeof d.errorCode === "string")?.errorCode ?? e?.status;
  } catch {
    return undefined;
  }
}

export const FCM_RETRY_DELAYS_MS = [1_000, 4_000];

/** One notification to one device: up to three tries when Google is busy, and once more with a fresh access token. */
export async function deliverFcm(
  attempt: (freshToken: boolean) => Promise<FcmAnswer>,
  sleep: (ms: number) => Promise<void>,
  delays: readonly number[] = FCM_RETRY_DELAYS_MS,
): Promise<{ outcome: "sent" | "gone" | "failed"; attempts: number; last: FcmAnswer }> {
  let attempts = 0;
  let retries = 0;
  let refreshed = false;
  let fresh = false;
  for (;;) {
    attempts++;
    let last: FcmAnswer;
    try {
      last = await attempt(fresh);
    } catch {
      last = { status: 0 };
    }
    fresh = false;
    const outcome = fcmOutcome(last);
    if (outcome === "sent" || outcome === "gone" || outcome === "failed") return { outcome, attempts, last };
    if (outcome === "refresh") {
      if (refreshed) return { outcome: "failed", attempts, last };
      refreshed = true;
      fresh = true;
      continue;
    }
    if (retries >= delays.length) return { outcome: "failed", attempts, last };
    await sleep(delays[retries]!);
    retries++;
  }
}
