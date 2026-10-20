// Native apps that may sign in with Authorization Code + PKCE (lib/nativeAuth.ts). Shared with the web's
// /connect page, so it has no imports. Redirect URIs must match exactly (RFC 8252 private-use schemes).
export const NATIVE_CLIENTS: Record<string, { label: string; redirectUris: readonly string[] }> = {
  "folevi-mac": { label: "Folevi for Mac", redirectUris: ["com.folevi.mac://auth/callback"] },
  // The Mac and iOS apps' own web views, signing in with Google in the browser (Google doesn't sign in inside
  // an app's web view): the browser hands the app a code, which its web view redeems (/native/redeem).
  "folevi-app": { label: "Folevi", redirectUris: ["folevi://auth/google"] },
  // The interface built into the Mac app (and later the iPhone and iPad app), signed in to an account
  // (docs/LOCAL_MODE_PLAN.md §1): native code keeps the bearer session and the page never sees it.
  "folevi-shell": { label: "Folevi app", redirectUris: ["folevi://auth/callback"] },
};

/** The registered client for this id and redirect URI, or null. */
export function nativeClient(clientId: string, redirectUri: string) {
  const client = Object.hasOwn(NATIVE_CLIENTS, clientId) ? NATIVE_CLIENTS[clientId]! : null;
  return client && client.redirectUris.includes(redirectUri) ? client : null;
}
