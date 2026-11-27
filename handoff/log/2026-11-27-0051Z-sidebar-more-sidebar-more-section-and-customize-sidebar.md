# Sidebar: More section and Customize sidebar

- Date: 2026-11-27 00:51 UTC
- Area: web
- Branch: claude/sidebar-more

PR to come (branch claude/sidebar-more). Owner request via the Folevi Main session, 2026-11-27.

What changed:
- The sidebar's own items (Home, Work with Foli AI, Foli DNA, Bookmarks, Drafts, All notes, Tasks, Calendar, Reviews, Shared with Me, Vault, Changes, Templates) now follow a per-account layout: apps/web/src/lib/app/sidebarLayout.ts (ids, defaults, resolve, move, reorder), saved by convex/sidebarLayout.ts (get/set, table sidebarLayouts, one row per person, deleted with the account) and in local mode by lib/local/functions/sidebarLayout.ts (library meta key sidebarLayout). E2EE router: pass.
- Default: Shared with Me, Changes and Templates under More; everything else on the sidebar. Home and Drafts can't go under More (they can still be reordered in the panel). An item a saved layout doesn't name (added later) goes in its default place: before the item after it by default, on the sidebar or under More as its default says.
- More (components/app/Sidebar.tsx): a row below the items, closed at first, open/closed remembered on the device (localStorage folevi:sidebar-more-open); it opens by itself when the page you're on is under it. Its last row is Customize.
- Right-click (or the Menu key / Shift+F10) on an item: Move to More / Move to sidebar, Customize sidebar...; on Home and Drafts: Always on the sidebar (disabled). Right-click on empty sidebar space or on More: Customize sidebar...
- Customize sidebar (components/app/SidebarCustomize.tsx): a checkbox per item shown here (checked = on the sidebar), drag to reorder, Move up / Move down buttons for the keyboard with a live-region announcement, Reset to default. Changes save as they're made.
- Search, Folders, Tags, Archive and Trash are not items and stay where they were.

Checked:
- Unit: apps/web/test/sidebar-layout.test.ts (9), tests/convex/sidebar-layout.test.ts (2), full web suite, contract snapshot (two new functions recorded), e2ee/parity/convex projects.
- e2e: e2e/sidebar-more-local.spec.ts passed 4 times against this worktree's shell dev server (local mode; covers More, right-click, Shift+F10, the panel's checkboxes, Move up, drag, empty-space right-click, auto-open, reload). e2e/sidebar-more.spec.ts (account: default layout, remembered More, right-click, the panel, a second sign-in seeing the layout, Reset) was not run here (ports 3000/3210/3211 busy with another session's backend); CI runs it.

Left:
- The Mac app's sidebar is native Swift (apps/native-kit WebSidebar.swift), so the Mac doesn't get More from the web; see the mac/ios/android entry.
- api.sidebarLayout is not in the engine's views (lib/engine/viewsSettings.ts) yet; the native apps need it there to read the layout.
