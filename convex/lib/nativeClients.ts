// Native apps that may sign in with Authorization Code + PKCE (lib/nativeAuth.ts). Shared with the web's
// /connect page, so it has no imports. Redirect URIs must match exactly (RFC 8252 private-use schemes).
export const NATIVE_CLIENTS: Record<string, { label: string; redirectUris: readonly string[] }> = {
  "folevi-mac": { label: "Folevi for Mac", redirectUris: ["com.folevi.mac://auth/callback"] },
};

/** The registered client for this id and redirect URI, or null. */
export function nativeClient(clientId: string, redirectUri: string) {
  const client = Object.hasOwn(NATIVE_CLIENTS, clientId) ? NATIVE_CLIENTS[clientId]! : null;
  return client && client.redirectUris.includes(redirectUri) ? client : null;
}
