# Testing

## Automated suites

| Suite | Command | Covers |
| --- | --- | --- |
| Schema & sync reducer | `pnpm --filter @folevi/editor-schema test` | golden round-trip (all block types + unknown future type), validation codes, v0→v1 migration, rank golden cases + property tests, tree invariants (property/generative: random nesting and reorders), Markdown import/export, HTML escaping, search normalization & highlighting, task projection/buckets/time zones, href sanitization, **9 golden sync scenarios** (create/edit/reorder/delete-restore offline, duplicate delivery, token expiry, server rejection, same-block conflict, upload interruption) |
| Email | `pnpm --filter @folevi/email test` | manifest ⇄ template contract (every placeholder declared, required variables used), fixtures, variable validation, Loops sender (retries, 429, 4xx, idempotency conflict, non-production recipient policy), webhook signatures, Auth0 Actions (link extraction host/path restriction, drop/retry, MFA/verified claims) |
| Convex integration | `pnpm exec vitest run` | bootstrap + seed, verified-email/MFA gates, session revocation, **tenant isolation** (reads, writes, pull, search), restricted docs + grants, role changes, invitation binding, **sync protocol** (idempotency, content conflicts, LWW positions, tombstones + restore, invalid blocks, cycles, orphan normalization, pull cursors, title conflicts), task projection, deterministic daily notes, **public links** (revocation, expiry, passwords, server secret), **deletion cascades**, file authorization, **admin RBAC + audit**, no content via admin, rate limits; plus static invariants (append-only audit log, every function authorized, dev issuer disabled in production, no content in logs) |
| Web unit | `pnpm --filter @folevi/web test` | editor ⇄ canonical conversion on the golden document, content-vs-position diffs, stable ranks on move, id repair, HTML paste normalization, web sync engine (durable IndexedDB queue across restart, ordered flush, re-auth) |
| End-to-end | `cd apps/web && E2E_NO_SERVER=1 npx playwright test` | signup → onboarding → Welcome; editor (Markdown shortcuts, slash menu, persistence, formatting, nesting, move, undo); offline edit + reconnect + second browser; durable queue across reload; folders/star/move/trash/restore; search with highlights; quick-add task → Today → calendar → complete; sharing + comments + notifications + public link (noindex, revoke); Markdown import report + export; account gates (unverified, MFA missing, signed out, session revoke); axe WCAG 2.2 AA checks on app views in light and dark and the marketing home; keyboard-only flow; admin authorization and audit (`admin.spec.ts`) |
| Mac | see `docs/MACOS.md` | Swift ports against the same golden fixtures (ranks, document round-trip, sync scenarios), SQLite store, Keychain wrapper, auth callback parsing, UI tests |
| Design tokens | `node packages/design-tokens/scripts/contrast.mjs` | WCAG contrast for every semantic pair in both themes |

E2E prerequisites: the local Convex backend and web dev server (README Quick start). Each test signs up a
fresh `@example.com` person through the development identity, so runs don't interfere with each other.

## Manual QA checklist (per release)

Web (Chrome, Safari, Firefox; 1440, 1024, 768, 375 widths; light and dark):
- Keyboard only: skip link, sidebar, command palette (⌘K), slash menu, block options (⌘.), move blocks
  (⌥⇧↑↓), inspector tabs (arrow keys), dialogs trap focus and return it.
- Screen reader (VoiceOver + Safari): sync status announcements are polite and not chatty; checkboxes
  announce state; menus and comboboxes announce options.
- `prefers-reduced-motion`, `prefers-contrast: more`, 200% zoom.
- Offline: DevTools → Offline, edit, reload (production build with service worker), reconnect.
- Two browsers editing the same block → conflict banner → Keep both.

Cross-client (same account on web and Mac): create on web → appears on Mac; edit offline on Mac →
reconnect → visible on web; create and complete a task; export a page; switch themes; confirm `/admin`
is denied for non-admins.

## Visual QA

`node apps/web/e2e/visual.mjs <outDir>` captures key screens (set `SHOT_PATHS`, `SHOT_THEMES`,
`SHOT_WIDTHS`) for review.
