import "server-only";
import { SignJWT, importPKCS8, jwtVerify } from "jose";
import { createHash, randomUUID } from "node:crypto";
import { isDevAuthEnabled } from "@/lib/env";

/**
 * Development-only identity: a local RS256 issuer trusted by the local Convex deployment
 * (convex/auth.config.ts, FOLEVI_DEV_AUTH_JWKS). It exists so every workflow can be exercised without an
 * Auth0 tenant. It is unreachable unless isDevAuthEnabled() and can never be enabled on Vercel production.
 */
export const DEV_COOKIE = "folevi_dev_session";

export interface DevUser {
  email: string;
  name: string;
  sid: string;
  mfa: boolean;
  verified: boolean;
}

function sessionKey(): Uint8Array {
  const secret = process.env.FOLEVI_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("FOLEVI_SESSION_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export async function createDevSessionCookie(user: Omit<DevUser, "sid"> & { sid?: string }): Promise<string> {
  if (!isDevAuthEnabled()) throw new Error("development sign-in is disabled");
  return await new SignJWT({ email: user.email, name: user.name, mfa: user.mfa, verified: user.verified })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sid ?? `web-${randomUUID()}`)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(sessionKey());
}

export async function readDevSession(value: string | undefined): Promise<DevUser | null> {
  if (!value || !isDevAuthEnabled()) return null;
  try {
    const { payload } = await jwtVerify(value, sessionKey(), { algorithms: ["HS256"] });
    if (typeof payload.email !== "string" || typeof payload.sub !== "string") return null;
    return {
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : payload.email,
      sid: payload.sub,
      mfa: payload.mfa !== false,
      verified: payload.verified !== false,
    };
  } catch {
    return null;
  }
}

export async function mintDevIdToken(user: DevUser, ttlSeconds = 3600): Promise<{ token: string; expiresAt: number }> {
  if (!isDevAuthEnabled()) throw new Error("development sign-in is disabled");
  const pem = Buffer.from(process.env.FOLEVI_DEV_AUTH_PRIVATE_KEY ?? "", "base64").toString("utf8");
  const key = await importPKCS8(pem, "RS256");
  const email = user.email.trim().toLowerCase();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const token = await new SignJWT({
    email,
    email_verified: user.verified,
    name: user.name,
    sid: user.sid,
    "https://folevi.com/email_verified": user.verified,
    "https://folevi.com/mfa": user.mfa,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: process.env.FOLEVI_DEV_AUTH_KID ?? "folevi-dev-1" })
    .setIssuer(process.env.FOLEVI_DEV_AUTH_ISSUER ?? "http://localhost:3000/dev-auth")
    .setAudience("folevi-dev")
    .setSubject(`dev|${createHash("sha256").update(email).digest("hex").slice(0, 24)}`)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(key);
  return { token, expiresAt };
}
