---
name: native-apps-in-monorepo
description: The folevi monorepo will hold native iOS and macOS apps beside the web app; Vercel deploys only apps/web
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-09-28T04:58:33.871Z
---

Folevi has (or will have) native macOS (`apps/macos`) and iOS apps in the same monorepo as the web app.

**Why:** The user said so on 2026-09-28 when setting the Vercel Root Directory to `apps/web`.

**How to apply:**
- Hosting, CI and tooling changes must not assume the repo is web-only.
- Vercel builds only `apps/web`. Its `ignoreCommand` in `apps/web/vercel.json` skips commits that touch only native apps or docs; when adding shared packages the web app depends on, add them to that path list.
- The native apps ship through Xcode, not Vercel.
- Still follow [[web-only-until-told]] and [[mac-follows-web]] for which app to change.
