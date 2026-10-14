// Refuses new passwords that appear in Have I Been Pwned's Pwned Passwords list, on sign-up, password
// change and password reset. Uses the range API's k-anonymity model: only the first 5 hex characters of the
// password's SHA-1 leave Folevi, the reply is padded so its size gives nothing away, and the match happens
// here. If the service is slow or down, the password is allowed (with a warning that never includes it), so
// sign-ups don't depend on a third party.
//
// Better Auth ships a haveIBeenPwned plugin, but it fails closed (any error refuses the password) and has no
// timeout; this keeps its approach and changes those two things.
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

export const BREACHED_PASSWORD_MESSAGE = "This password has appeared in a data breach. Choose a different one.";
export const BREACHED_PASSWORD_CODE = "PASSWORD_COMPROMISED";
const RANGE_API = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2000;

/** Which body field holds the new password, per endpoint. */
const PASSWORD_FIELDS: Record<string, string> = {
  "/sign-up/email": "password",
  "/change-password": "newPassword",
  "/reset-password": "newPassword",
};

async function sha1Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * "breached" when the password is in Pwned Passwords, "ok" when it isn't, "unknown" when the service
 * didn't answer in time or answered with an error.
 */
export async function pwnedPasswordStatus(password: string, fetchImpl: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): Promise<"breached" | "ok" | "unknown"> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"unknown">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("unknown");
    }, timeoutMs);
  });
  const lookup = (async (): Promise<"breached" | "ok" | "unknown"> => {
    const res = await fetchImpl(RANGE_API + prefix, { headers: { "Add-Padding": "true", "User-Agent": "Folevi password check" }, signal: controller.signal });
    if (!res.ok) return "unknown";
    for (const line of (await res.text()).split("\n")) {
      const [candidate, count] = line.trim().split(":");
      // Padding rows have a count of 0.
      if (candidate?.toUpperCase() === suffix && Number(count) > 0) return "breached";
    }
    return "ok";
  })().catch(() => "unknown" as const);
  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function breachedPasswords() {
  return {
    id: "folevi-breached-passwords",
    hooks: {
      before: [
        {
          matcher: (ctx) => Object.hasOwn(PASSWORD_FIELDS, ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const field = PASSWORD_FIELDS[ctx.path];
            const password = (ctx.body as Record<string, unknown> | undefined)?.[field!];
            if (typeof password !== "string") return;
            // Too short or too long is refused by the endpoint itself; no need to ask about it.
            const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
            if (password.length < minPasswordLength || password.length > maxPasswordLength) return;
            const status = await pwnedPasswordStatus(password);
            if (status === "breached") throw new APIError("BAD_REQUEST", { message: BREACHED_PASSWORD_MESSAGE, code: BREACHED_PASSWORD_CODE });
            if (status === "unknown") console.warn(`Pwned Passwords didn't answer for ${ctx.path}; the password was allowed without the breach check.`);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
