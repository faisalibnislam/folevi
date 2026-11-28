---
name: platforms-paused-2026-11-28
description: "Owner decision (2026-11-28): Android, Windows and Linux apps paused; only Mac, iOS (iPhone, iPad, iPhone Duo), Folevi Server and the web app stay; the rest say Coming soon"
metadata:
  type: project
  modified: 2026-11-28
---

The owner, 2026-11-28: "We are pausing: Android, Windows and Linux app. Only Mac, iOS (iPhone, iPad, iPhone Duo), Self-Hosted will remain. Rest will say coming soon."

- Available: the Mac app, the iPhone and iPad app (including iPhone Duo), Folevi Server (self-hosted, labeled "Early Beta" since 2026-11-28: the owner, "Self-Hosted version will say (Early Beta)") and the web app.
- Paused: the Android app, and the Windows and Linux app (`apps/desktop`). Their code, release scripts and docs stay in the repo.
- The website, the apps, Folevi Server and emails show Android, Windows and Linux as "Coming soon", with no download links. `/windows` and `/linux` stay up as Coming soon pages and are out of the sitemap.
- Folevi Server's Linux server packages, Docker image and NAS packages are self-hosting and stay. Only the Linux desktop app is paused.
- No new releases for Android, Windows or Linux, and feature parity with `apps/desktop` ([desktop-feature-parity](desktop-feature-parity.md)) is on hold until the owner resumes them.
- Already published builds (folevi.com download files, the Snap Store, Play internal testing, the apt/rpm repos and update feeds) are not withdrawn by this decision; removing them is the owner's call.

This replaces the 2026-11-26 launch scope (every platform launches, Linux marked Beta).
