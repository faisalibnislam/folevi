// Sign in with Apple (convex/auth.ts appleSignIn): its settings, and the client secret Apple asks for.
//
// Apple has no fixed client secret. Each token request carries a JWT signed with the team's Sign in with
// Apple key (.p8, ES256): iss = team ID, sub = the Services ID, aud = https://appleid.apple.com, and an expiry
// at most six months out. Folevi makes it here, at runtime, from the key in the environment, keeps it for its
// lifetime and makes a new one a day before it runs out, so nobody ever renews it by hand. Runs in Convex's
// default runtime (Web Crypto), where the auth routes run.

/** The settings, from APPLE_SIGNIN_* in the Convex environment (docs/DEPLOYMENT.md, "Sign in with Apple"). */
export type AppleSignInConfig = {
  /** The Services ID, the web client id ("com.folevi.signin"). */
  clientId: string;
  /** The Apple Developer team ID ("7K32QQ2FX8"). */
  teamId: string;
  /** The Sign in with Apple key's ID. */
  keyId: string;
  /** The key itself: the .p8 file's PEM text. */
  privateKey: string;
  /** The iPhone and iPad app's bundle ID: the audience of the id tokens its native sign-in sheet returns. */
  bundleId: string;
};

/** The iOS app's bundle ID when APPLE_SIGNIN_BUNDLE_ID isn't set. */
export const DEFAULT_APPLE_BUNDLE_ID = "com.folevi.ios";

/** Apple's limit for a client secret's lifetime: 6 months (15777000 seconds). */
export const APPLE_SECRET_MAX_SECONDS = 15_777_000;
/** How long each client secret Folevi makes is valid. */
export const APPLE_SECRET_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
/** A new one is made once less than this is left. */
export const APPLE_SECRET_RENEW_SECONDS = 60 * 60 * 24;

const APPLE_AUDIENCE = "https://appleid.apple.com";

/** The settings when all four required variables are set (an incomplete set means no Apple sign-in). */
export function appleSignInConfig(env: Record<string, string | undefined> = process.env): AppleSignInConfig | null {
  const clientId = env.APPLE_SIGNIN_CLIENT_ID?.trim();
  const teamId = env.APPLE_SIGNIN_TEAM_ID?.trim();
  const keyId = env.APPLE_SIGNIN_KEY_ID?.trim();
  const privateKey = env.APPLE_SIGNIN_KEY?.trim();
  if (!clientId || !teamId || !keyId || !privateKey) return null;
  return { clientId, teamId, keyId, privateKey, bundleId: env.APPLE_SIGNIN_BUNDLE_ID?.trim() || DEFAULT_APPLE_BUNDLE_ID };
}

/**
 * The key's DER bytes (PKCS #8) from the .p8 text. Accepts the file as is, the same with its line breaks
 * written as "\n" (how some secret stores keep multi-line values), or just the base64 body.
 */
export function pkcs8FromPem(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "")
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error("APPLE_SIGNIN_KEY isn't a .p8 key");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new client secret for these settings, issued at `now` (ms). */
export async function makeAppleClientSecret(config: AppleSignInConfig, now = Date.now()): Promise<{ jwt: string; expiresAt: number }> {
  const iat = Math.floor(now / 1000);
  const exp = iat + Math.min(APPLE_SECRET_LIFETIME_SECONDS, APPLE_SECRET_MAX_SECONDS);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8FromPem(config.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const input = `${base64url(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }))}.${base64url(
    JSON.stringify({ iss: config.teamId, iat, exp, aud: APPLE_AUDIENCE, sub: config.clientId }),
  )}`;
  // Web Crypto's ECDSA signature is already the raw r||s (64 bytes) that JWS wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input)));
  return { jwt: `${input}.${base64url(signature)}`, expiresAt: exp * 1000 };
}

let cached: { fingerprint: string; jwt: string; expiresAt: number } | null = null;
let pending: { fingerprint: string; promise: Promise<{ jwt: string; expiresAt: number }> } | null = null;

const fingerprintOf = (c: AppleSignInConfig) => `${c.clientId}\u0000${c.teamId}\u0000${c.keyId}\u0000${c.privateKey}`;

/**
 * The client secret to send Apple now: the one already made for these settings while more than a day of it is
 * left, otherwise a new one. Settings that change (another key, team or Services ID) get a new one at once.
 */
export async function appleClientSecret(config: AppleSignInConfig, now = Date.now()): Promise<string> {
  const fingerprint = fingerprintOf(config);
  if (cached && cached.fingerprint === fingerprint && cached.expiresAt - now > APPLE_SECRET_RENEW_SECONDS * 1000) return cached.jwt;
  if (!pending || pending.fingerprint !== fingerprint) {
    const promise = makeAppleClientSecret(config, now);
    pending = { fingerprint, promise };
    promise.then(
      (made) => {
        cached = { fingerprint, ...made };
        if (pending?.promise === promise) pending = null;
      },
      () => {
        if (pending?.promise === promise) pending = null;
      },
    );
  }
  return (await pending.promise).jwt;
}

/** Forgets the kept client secret (tests). */
export function forgetAppleClientSecret(): void {
  cached = null;
  pending = null;
}

/** Whether an address is one of Apple's private relay addresses ("Hide My Email"). */
export function isApplePrivateRelay(email: string | null | undefined): boolean {
  return typeof email === "string" && /@privaterelay\.appleid\.com$/i.test(email.trim());
}
