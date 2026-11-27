# Sidebar More and Customize sidebar: to do in the native apps

- Date: 2026-11-27 00:51 UTC
- Area: mac, ios, android
- Branch: claude/sidebar-more

The web, Windows and Linux sidebar has a More section and Customize sidebar (web log entry of the same day, convex/sidebarLayout.ts). The native apps don't have it yet: the Mac sidebar (apps/native-kit WebSidebar.swift, WebSidebar+Mac.swift), the native iPhone/iPad app and the Android app. The owner said iPhone/iPad and Android come later; the Mac was assumed to get it from the web, but its sidebar is native, so it needs the same work. To build it: expose sidebarLayout.get/set through lib/engine/viewsSettings.ts (and pnpm engine:gen), then mirror lib/app/sidebarLayout.ts (ids, defaults: Shared with Me, Changes, Templates under More; Home and Drafts locked; new items in their default place), More (closed at first, opens for the current page), right-click Move to More / Move to sidebar, and the Customize sidebar panel. Areas: mac, ios, android.
