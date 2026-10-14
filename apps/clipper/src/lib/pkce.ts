// PKCE (RFC 7636) for the sign-in: a random verifier kept in the service worker, its S256 challenge sent
// with the authorize request, and a random state to match the answer to the request.

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes as base64url: 43 characters, inside the 43 to 128 that RFC 7636 allows. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The S256 challenge for a verifier. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function newPkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = randomToken();
  return { verifier, challenge: await challengeFor(verifier), state: randomToken(16) };
}
