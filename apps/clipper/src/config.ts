// Where the clipper talks to: Folevi's web app, which serves the OAuth server (/api/auth/oauth2/...) and the
// MCP endpoint (/mcp). The build sets __FOLEVI_ORIGIN__ (scripts/build.mjs): https://app.folevi.com for every
// release, a local dev server only for `pnpm build:dev`.

declare const __FOLEVI_ORIGIN__: string;
declare const __CLIPPER_VERSION__: string;

export const FOLEVI_ORIGIN: string = __FOLEVI_ORIGIN__;

/** The extension's version (package.json), sent as the MCP client's version. */
export const CLIPPER_VERSION: string = __CLIPPER_VERSION__;

/** What the clipper asks for at sign-in: creating notes, and a refresh token so it stays signed in. Nothing to read. */
export const SCOPES = "notes:write offline_access";

/**
 * What it asks for the first time someone searches their notes (the owner, 2026-11-19: ask for reading only
 * when it's first needed): reading notes as well. Folevi's consent screen asks again for that.
 */
export const READ_SCOPES = "notes:read notes:write offline_access";

/** How it names itself when it registers (shown on Folevi's consent screen and in Settings > Connected apps). */
export const CLIENT_NAME = "Folevi Web Clipper";

/** The longest note a clip makes (create_note takes up to 100,000 characters of Markdown). */
export const MAX_CLIP_CHARS = 100_000;
