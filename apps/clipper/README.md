# Folevi Web Clipper

A Chrome and Edge extension (Manifest V3, Chrome 116 or later) that saves the article you're reading, the part you selected, or a link as a clean note under your Folevi Inbox page.

It needs no API of its own. It connects like any other connected app: Folevi's OAuth 2.1 server and its MCP endpoint at `https://app.folevi.com/mcp`.

## How it works

- **Sign-in.** On first use the service worker registers the clipper as a public OAuth client (RFC 7591) with its redirect URI, `https://<extension-id>.chromiumapp.org/` from `chrome.identity.getRedirectURL()`. It then opens Folevi's authorize URL with PKCE (S256) in `chrome.identity.launchWebAuthFlow` and trades the code for tokens. It asks only for `notes:write offline_access`. Folevi's consent screen offers an app that asks for no read scope adding only, and the grant is saved as create-only ("Only add new things"); `saveGrant` in `convex/mcp.ts` enforces that on the server too. The registration is reused; if Folevi no longer knows it, the clipper registers again.
- **Tokens.** The refresh token and the registration live in `chrome.storage.local`, the access token in `chrome.storage.session` (memory only). An expiring token is refreshed before use; a 401 refreshes once and retries; a refused refresh signs out. Nothing is logged.
- **Reading the page.** When you open the popup or use the context menu, `extractor.js` (Mozilla Readability plus a Markdown converter ported from the web app's importer) is injected into that tab only, through `activeTab` and `scripting`. Readability works on a copy of the page. Images stay remote links and are never uploaded.
- **Saving.** The service worker calls the MCP endpoint (`initialize`, then `tools/call`): `list_places` for the place picker and `create_note` with `inInbox: true`, which files the note under the Inbox page of that place. The note starts with "Clipped from [title](url) on 14 October 2026". Clips are capped at 100,000 characters, which is `create_note`'s limit.

## Layout

| Path | What it is |
| --- | --- |
| `manifest.json` | The manifest template (the build sets the version from `package.json`) |
| `src/background.ts` | Service worker: sign-in, saving, the "Clip to Folevi" context menu, popup messages |
| `src/popup/` | The toolbar popup (plain TypeScript and CSS, Folevi's neutral chrome) |
| `src/extractor.ts` | Injected into the page: Readability, selection, link text |
| `src/lib/` | OAuth and PKCE, the token session, the MCP client, HTML to Markdown, the note builder |
| `test/` | Vitest unit tests (jsdom for the page side) |
| `scripts/build.mjs`, `scripts/package.mjs` | esbuild bundle into `dist/`; the store zip in `release/` |
| `STORE.md` | Chrome Web Store and Edge Add-ons listing text, permission reasons and privacy practices |

## Commands

The clipper sits outside the pnpm workspace with its own lockfile (like `apps/desktop`), so the web app's install and Vercel build never see it.

```sh
cd apps/clipper
pnpm install --ignore-workspace
pnpm typecheck
pnpm test
pnpm build        # dist/, for app.folevi.com
pnpm package      # builds, checks, and writes release/folevi-clipper-<version>.zip
```

## Trying it locally

`pnpm build:dev` builds `dist/` for a local Folevi at `http://app.localhost:3002` (set `FOLEVI_ORIGIN` for another address). It adds that origin to `host_permissions` and names the extension "Folevi Web Clipper (development)". `pnpm package` refuses a development build, so it can't reach a store by mistake.

Load it in Chrome or Edge: open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose "Load unpacked" and pick `apps/clipper/dist`.

The web app's end-to-end test `apps/web/e2e/web-clipper.spec.ts` loads a development build in Playwright's Chromium and runs the sign-in and a clip against the dev server. It's skipped when this package's dependencies aren't installed.

## Releasing

Bump `version` in `package.json`, run `pnpm package`, and upload the zip to both stores. `STORE.md` has the listing and what to prepare first.
