---
name: folevi-keeps-com-bundle-ids
description: Folevi keeps its com.folevi.* bundle IDs; do not rename to app.folevi despite the global Apple convention
metadata:
  node_type: memory
  type: project
  originSessionId: 268f5a8a-585a-47a3-bd85-16826be58f9a
  modified: 2026-11-16T06:14:43.772Z
---

Folevi keeps its current bundle IDs: com.folevi.ios (+ .share, .widgets, .tests, .uitests), com.folevi.mac (release) and com.folevi.mac.dev (dev), App Group group.com.folevi, iCloud iCloud.com.folevi. The owner decided on 2026-11-16 not to move to app.folevi.*.

**Why:** a rename would make it a new App Store app and reset users' settings, keychain items and Mac privacy permissions.

**How to apply:** this overrides the global "rename existing projects to app.<appname>" rule for Folevi. Don't propose or perform the rename, and don't list it as a pending owner decision.
