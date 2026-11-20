---
name: forward-mac-ui-improvements-to-web-session
description: "When a Mac UI improvement would also help the web app, send it to the web session instead of only fixing the Mac"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 35e89241-b894-4220-9018-80cdbd58c6de
  modified: 2026-11-18T18:01:21.149Z
---

Said by the owner (Faisal) in chat on 2026-11-19, during the Mac UI audit on branch `mac-ui-audit`: "some of the areas you improve, if you think the web version of the app could use that improvement, please send it to the web session so that web app is also improved."

**Why:** the owner wants the web app to get the same polish, and a separate session owns web work.

**How to apply:** after improving a Mac screen, check the web's own version of it (`apps/web/src/components/...`). If it has the same weakness, send a self-contained brief (file paths, the design, picture paths, what is unconfirmed) to the web session with SendMessage. My choice of target on 2026-11-19 was the session titled "Web app interface improvements" (`local_e651b96b-345f-47cf-8adb-b4ea60b24a27`); the owner did not name it, so confirm it is still the right one (list sessions) before sending. Do not forward Mac-only decisions (Liquid Glass menus, pill segments, the light shadow scale) as instructions: flag them as "ask the owner". Related: [[mac-polish-rules-2026-11-18]], [[mac-native-look-decisions]].
