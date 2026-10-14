// Folevi's MCP server: what connected apps (Claude, ChatGPT, Cursor, …) can ask for, and where.
//
// Apps sign in with OAuth 2.1 against Better Auth's OAuth provider (convex/auth.ts) and send the access
// token to the MCP endpoint (convex/mcp/http.ts, served at https://app.folevi.com/mcp). Tokens are opaque:
// stored as a SHA-256 hash and checked against the auth component's table on every request, so revoking
// a connection takes effect at once.

/** What a connected app can be allowed to do. Places (Personal, workspaces) are chosen at consent. */
export const MCP_SCOPES = ["notes:read", "notes:write", "tasks:read", "tasks:write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** Every scope the authorization server knows (refresh tokens come with offline_access). */
export const OAUTH_SCOPES = [...MCP_SCOPES, "offline_access"] as const;

/** Prefixes on the tokens apps get, so a leaked one is recognisable (secret scanners, logs). */
export const ACCESS_TOKEN_PREFIX = "fvat_";
export const REFRESH_TOKEN_PREFIX = "fvrt_";

const origin = () => (process.env.SITE_URL ?? process.env.FOLEVI_APP_URL ?? "http://app.localhost:3000").replace(/\/$/, "");

/** The MCP endpoint, which is also the resource (audience) tokens are issued for. */
export const mcpResourceUrl = () => `${origin()}/mcp`;

/** The authorization server's issuer: Better Auth's base URL. */
export const authIssuer = () => `${origin()}/api/auth`;
