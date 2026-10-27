// Whether a password is in Have I Been Pwned's Pwned Passwords list, checked on the device: only the first 5
// characters of its SHA-1 go to the server (vaultItems.breachRange), which asks the service; the match happens here.
// The same k-anonymity check sign-up uses (convex/lib/breachedPasswords.ts).

async function sha1Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** "breached", "ok", or "unknown" when the service didn't answer. `range` fetches a prefix's suffixes. */
export async function breachStatus(password: string, range: (prefix: string) => Promise<string[]>): Promise<"breached" | "ok" | "unknown"> {
  const hash = await sha1Hex(password);
  let suffixes: string[];
  try {
    suffixes = await range(hash.slice(0, 5));
  } catch {
    return "unknown";
  }
  if (!suffixes.length) return "unknown";
  return suffixes.includes(hash.slice(5)) ? "breached" : "ok";
}
