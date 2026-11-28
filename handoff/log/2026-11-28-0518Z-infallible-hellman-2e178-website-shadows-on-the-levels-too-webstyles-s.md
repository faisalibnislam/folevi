# Website shadows on the levels too; WebStyles.swift shadow values regenerated

- Date: 2026-11-28 05:18 UTC
- Area: web
- Branch: claude/infallible-hellman-2e178f

Changed: the website (`marketing.css` and `components/marketing`) drops its own card, sheet, pop and lift and its
one-off shadows for the levels; `shadow-scale.test.ts` now covers it. `WebStyles.swift` got the new shadow values
from `pnpm styles:gen` (only the shadow fields; the file's other values are older than the web and were left).

Checked: web vitest, tsc, FoleviDesign build; the website home page in light and dark on app.localhost:3007's
marketing host, no shadow resolving to none.

Left: PR 190's Home shadows (its own branch).
