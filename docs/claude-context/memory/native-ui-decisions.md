---
name: native-ui-decisions
description: "2026-10-24 owner decisions to make everything except the editor native Swift on iPhone, iPad and Mac, data via the web layer, one big release"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-24T02:10:03.230Z
---

2026-10-24, after the owner reported the iPhone app sluggish and asked "can we make more part of the app native swift to make it faster, smoother?". Decisions (picker answers):
- **Scope:** everything except the editor/note pages goes native Swift: app frame (top bars, bottom buttons, back swipe, note-open zoom transition, sheets, menus, keyboard toolbar, instant startup), list screens (Home, All notes, folders, search, Notifications, account/place switcher, Tasks, Calendar), plus Settings, Templates, Archive, Trash, sharing, Quick Add, onboarding. The editor and note page stay web (WKWebView).
- **Data:** native screens get data from the existing web layer through the bridge (one source of truth for sync, offline, E2EE, multi-account); no native data layer.
- **Platforms:** iPhone, iPad and Mac (AppKit) all get the native parts.
- **Rollout:** all at once, one big release (not screen by screen).

**Why:** speed and native smoothness; supersedes "keep it hybrid, no SwiftUI rewrite" and "menus stay web menus" from [[ios-polish-2026-10-22]] and [[mac-webkit-shell]] for everything outside the editor.
**How to apply:** the website keeps the web UI; web fixes still matter for the website. iPhone feedback also applies to iPad ([[iphone-feedback-applies-to-ipad]]). Ask before TestFlight uploads and notarization ([[apple-developer-account]]).

Plan: docs/NATIVE_APP_PLAN.md (commit b870716a). Follow-up answers 2026-10-24: technical Settings sections (Webhooks, API tokens, Connected apps, AI export, workspace Data) open as in-app web pages this release; Reviews and Graph stay web inside native bars; background sync (silent push + nightly task) for every plan including Free; attachments default 2 GB or 10% of free space (smaller), Wi-Fi only; keep improving the web phone layout (phone browsers); start building now (ships as 1.1.00).
