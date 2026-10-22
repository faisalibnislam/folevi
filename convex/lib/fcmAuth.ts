"use node";
// An OAuth access token for FCM's HTTP v1 API from the Firebase service account (lib/fcm.ts FCM_SERVICE_ACCOUNT):
// a JWT signed with the account's RSA key (RS256), exchanged at Google's token endpoint for an hour-long token,
// kept for 50 minutes (per Node process). Never logs the key or a token.
import { createPrivateKey, sign } from "node:crypto";
import type { FcmConfig } from "./fcm";

const KEEP_MS = 50 * 60_000;
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let cached: { email: string; token: string; at: number } | null = null;

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** The signed assertion Google's token endpoint takes (exported for tests). */
export function fcmAssertion(config: FcmConfig, now = Date.now()): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(now / 1000);
  const claims = base64url(JSON.stringify({ iss: config.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }));
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), createPrivateKey(config.privateKey));
  return `${input}.${base64url(signature)}`;
}

/** The access token: the one made in the last 50 minutes, or a new one (`fresh` always makes one). */
export async function fcmAccessToken(config: FcmConfig, fetchImpl: typeof fetch = fetch, now = Date.now(), fresh = false): Promise<string> {
  if (!fresh && cached && cached.email === config.clientEmail && now - cached.at < KEEP_MS) return cached.token;
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: fcmAssertion(config, now) }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown };
  if (!res.ok || typeof body.access_token !== "string") throw new Error(`fcm.token_refused ${res.status}`);
  cached = { email: config.clientEmail, token: body.access_token, at: now };
  return body.access_token;
}

/** Forgets the kept token (tests). */
export function forgetFcmToken(): void {
  cached = null;
}
