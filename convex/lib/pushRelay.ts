// Folevi Server's push relay client (docs/self-hosting/CONTRACT.md §9 `POST /v1/push`). Apple and Google only
// accept pushes signed with Folevi's own keys, so a server hands each notice to Folevi Connect, which sends it.
// The relay gets the device token and the short notice the cloud would send anyway, never a note. Used by
// convex/apnsSend.ts and convex/fcmSend.ts when the server edition has push.relay on. Never logs a token or text.
import { connectToken, connectUrl } from "./edition";

export interface RelayPush {
  platform: "apns" | "fcm";
  token: string;
  environment?: "production" | "sandbox";
  title: string;
  body?: string;
  data?: Record<string, string>;
  collapseId?: string;
  threadId?: string;
}

export type RelayOutcome = { outcome: "sent" | "gone" | "failed"; status: number };

/** The JSON body the relay receives. */
export function relayPushBody(p: RelayPush): Record<string, unknown> {
  return {
    platform: p.platform,
    token: p.token,
    ...(p.environment ? { environment: p.environment } : {}),
    title: p.title,
    body: p.body ?? "",
    ...(p.data && Object.keys(p.data).length ? { data: p.data } : {}),
    ...(p.collapseId ? { collapseId: p.collapseId } : {}),
    ...(p.threadId ? { threadId: p.threadId } : {}),
  };
}

const RELAY_TIMEOUT_MS = 10_000;

/** How long to wait before the one retry of a busy relay (503). */
const BUSY_RETRY_MS = 1_500;

/**
 * One notice through the relay (CONTRACT §9.1). 2xx: sent. 410 `token_gone`: the device token is dead (the caller
 * removes it). 503: the provider is busy, tried once more shortly after. Anything else, or no Connect token: failed.
 */
export async function sendThroughRelay(p: RelayPush, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<RelayOutcome> {
  const token = connectToken();
  if (!token) return { outcome: "failed", status: 0 };
  let last: RelayOutcome = { outcome: "failed", status: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${connectUrl()}/v1/push`, {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(relayPushBody(p)),
      });
      if (res.status >= 200 && res.status < 300) return { outcome: "sent", status: res.status };
      if (res.status === 410) return { outcome: "gone", status: res.status };
      last = { outcome: "failed", status: res.status };
      if (res.status !== 503) return last;
    } catch {
      return { outcome: "failed", status: 0 };
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 1) await sleep(BUSY_RETRY_MS);
  }
  return last;
}
