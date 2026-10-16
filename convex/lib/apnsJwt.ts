"use node";
// The provider token APNs wants with every request: a JWT signed with the .p8 key (ES256), naming the key
// (kid) and the team (iss). Apple refuses tokens older than an hour and asks for no more than one new one
// every 20 minutes, so each is kept for 50 minutes (per Node process, which serves many actions).
import { createPrivateKey, sign } from "node:crypto";
import type { ApnsConfig } from "./apns";

const KEEP_MS = 50 * 60_000;

let cached: { keyId: string; teamId: string; jwt: string; at: number } | null = null;

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** A JWT for these settings: the one made in the last 50 minutes, or a new one (`fresh` always makes one). */
export function apnsJwt(config: Pick<ApnsConfig, "keyId" | "teamId" | "key">, now = Date.now(), fresh = false): string {
  if (!fresh && cached && cached.keyId === config.keyId && cached.teamId === config.teamId && now - cached.at < KEEP_MS) return cached.jwt;
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }));
  const input = `${header}.${claims}`;
  // JWS wants the raw r||s signature (64 bytes), not DER.
  const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey(config.key), dsaEncoding: "ieee-p1363" });
  const jwt = `${input}.${base64url(signature)}`;
  cached = { keyId: config.keyId, teamId: config.teamId, jwt, at: now };
  return jwt;
}

/** Forgets the kept JWT (tests). */
export function forgetApnsJwt(): void {
  cached = null;
}
