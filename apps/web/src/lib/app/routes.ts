// Server-safe list of product route heads (mirrors parseRoute in router.tsx).
export const APP_ROUTE_HEADS = new Set([
  "documents",
  "notes",
  "d",
  "ai",
  "graph",
  "tasks",
  "inbox",
  "calendar",
  "review",
  "changes",
  "daily",
  "shared",
  "vault",
  "templates",
  "starred",
  "archive",
  "trash",
  "drafts",
  "unsorted",
  "folders",
  "tags",
  "settings",
  "help",
  "onboarding",
  "quick-add",
  // A floating note's window (lib/app/float.ts).
  "float",
  "place-sync",
  "oauth",
  "invite",
  "share-invite",
  "share",
  // The native apps' idle page (native chrome mode): the engine runs, nothing is drawn.
  "native",
]);

/**
 * Pages outside the product shell that are rendered per request too: the admin, the sign-in flows (and the apps'
 * own sign-in page), and first setup. (/forgot-password is prerendered, so it isn't one.)
 */
export const REQUEST_PAGE_HEADS: readonly string[] = ["admin", "setup", "signin", "signup", "connect", "verify-email", "reset-password", "two-factor", "app-google"];

/** Per-request pages that only exist with more of a path: a share page, an invitation, a Vault link. */
export const REQUEST_PAGE_PREFIXES: readonly string[] = ["s", "join", "vault-link"];

const NONCE_ROUTE = new RegExp(`^/(?:(?:${[...APP_ROUTE_HEADS, ...REQUEST_PAGE_HEADS].join("|")})(?:/|$)|(?:${REQUEST_PAGE_PREFIXES.join("|")})/)`);

/**
 * Whether a path is rendered per request and so gets the nonce content policy, without 'unsafe-inline'
 * (src/proxy.ts): every product route there is (APP_ROUTE_HEADS, so a new one can't be left out) and the pages
 * above. Statically prerendered pages can't carry a per-request nonce and keep next.config's static policy.
 */
export function isNonceRoute(pathname: string): boolean {
  return NONCE_ROUTE.test(pathname);
}
