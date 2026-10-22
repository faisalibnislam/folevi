// A passkey as a way to unlock (docs/E2EE_DESIGN.md §4.7.2): a credential of its own, made by this ceremony
// (not the sign-in passkey), used only for its PRF output. The PRF output, through HKDF "passkey/wrap", wraps
// the account master key. Offered only where the browser's passkeys support PRF; never in a native app (the
// Mac, iPhone and iPad, Android): their own origins can't use app.folevi.com passkeys and their web views have
// no dependable PRF (§14 Q2).
import { prfWrapKey, randomBytes, toBase64Url, fromBase64Url, openRecord, sealRecord } from "@folevi/local-store/e2ee";
import { inNativeApp } from "./macBridge";

export type PasskeyFailure = "unsupported" | "cancelled";

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | ArrayBufferView } } };

/** Whether this page can even try (WebAuthn present, a secure context, not a native app). */
export function passkeysPossible(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials && window.isSecureContext !== false && !inNativeApp();
}

/** The relying party: the site itself (app.folevi.com in production; app.localhost in development). */
export function rpId(): string {
  return location.hostname;
}

const own = (b: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
};

function prfOutput(cred: PublicKeyCredential): Uint8Array | null {
  const ext = cred.getClientExtensionResults() as PrfResults;
  const first = ext.prf?.results?.first;
  if (!first) return null;
  const out = first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  return out.length === 32 ? new Uint8Array(out) : null;
}

function failure(e: unknown): PasskeyFailure {
  const name = (e as { name?: string })?.name;
  return name === "NotSupportedError" || name === "SecurityError" ? "unsupported" : "cancelled";
}

/** Evaluates the PRF of one of these credentials (the person picks). */
export async function evaluatePrf(creds: { credentialId: string; prfSalt: Uint8Array }[]): Promise<{ credentialId: string; prfOutput: Uint8Array } | PasskeyFailure> {
  if (!passkeysPossible() || creds.length === 0) return "unsupported";
  const evalByCredential: Record<string, { first: Uint8Array<ArrayBuffer> }> = {};
  for (const c of creds) evalByCredential[c.credentialId] = { first: own(c.prfSalt) };
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        rpId: rpId(),
        challenge: own(randomBytes(32)),
        allowCredentials: creds.map((c) => ({ type: "public-key" as const, id: own(fromBase64Url(c.credentialId)) })),
        userVerification: "required",
        extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    return failure(e);
  }
  if (!cred) return "cancelled";
  const out = prfOutput(cred);
  if (!out) return "unsupported";
  return { credentialId: toBase64Url(new Uint8Array(cred.rawId)), prfOutput: out };
}

/**
 * Makes a dedicated encryption passkey and gets its PRF output (from create where the browser gives it,
 * otherwise from a following get with the same salt). "unsupported" when the browser's passkeys have no PRF.
 */
export async function createPrfCredential(email: string): Promise<{ credentialId: string; prfSalt: Uint8Array; prfOutput: Uint8Array } | PasskeyFailure> {
  if (!passkeysPossible()) return "unsupported";
  const salt = randomBytes(32);
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { id: rpId(), name: "Folevi" },
        user: { id: own(randomBytes(16)), name: email || "Folevi", displayName: "Folevi encryption" },
        challenge: own(randomBytes(32)),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -8 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: own(salt) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    return failure(e);
  }
  if (!cred) return "cancelled";
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (ext.prf?.enabled !== true) return "unsupported";
  const credentialId = toBase64Url(new Uint8Array(cred.rawId));
  let out = prfOutput(cred);
  if (!out) {
    const r = await evaluatePrf([{ credentialId, prfSalt: salt }]);
    if (typeof r === "string") return r;
    out = r.prfOutput;
  }
  return { credentialId, prfSalt: salt, prfOutput: out };
}

/** The AMK wrapped with a passkey's PRF output (zeroes `prf`). */
export async function wrapWithPrf(prf: Uint8Array, epoch: number, context: string, amk: Uint8Array): Promise<Uint8Array> {
  try {
    return await sealRecord(await prfWrapKey(new Uint8Array(prf)), epoch, context, amk);
  } finally {
    prf.fill(0);
  }
}

/** The AMK, or null when the PRF output doesn't open the wrap (zeroes `prf`). */
export async function openWithPrf(prf: Uint8Array, context: string, wrapped: Uint8Array): Promise<Uint8Array | null> {
  try {
    return await openRecord(await prfWrapKey(new Uint8Array(prf)), context, wrapped);
  } catch {
    return null;
  } finally {
    prf.fill(0);
  }
}
