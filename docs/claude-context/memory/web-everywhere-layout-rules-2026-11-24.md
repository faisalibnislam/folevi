---
name: web-everywhere-layout-rules-2026-11-24
description: "Owner's 2026-11-24 layout rule for the one web app: width decides; under ~700 px every window (phones, folded Duo, narrow Mac/Windows/Linux/Googlebook windows) gets the phone layout with the bottom bar"
metadata:
  node_type: memory
  type: project
  originSessionId: 0ee6a4e7-d5d1-4063-8af3-7077b225c910
  modified: 2026-11-24T07:27:13.135Z
---

On 2026-11-24 the owner answered (AskUserQuestion, recommended option) for the web app that now runs everywhere
([[one-web-app-everywhere-2026-11-24]]):
- **Width decides, on every device.** A window under about 700 px gets the phone layout with the bottom bar: phones,
  the folded iPhone Duo, iPad Slide Over, and a narrow window on Mac, Windows, Linux or a Googlebook. Wider windows
  get the sidebar (tablets and computers). Never decide by the device model (an open Duo is an iPhone at 951 pt and
  must get the tablet layout).
- Duo: tablet when open, phone when closed, nothing interactive in the fold.

**Why:** one rule everywhere is the owner's consistency-first ask.
**How to apply:** use `apps/web/src/lib/platform.ts` (`formFactor()`, `<html data-form>`) for layout choices, not
user-agent checks. Related: [[tabs-match-web-2026-11-24]], [[iphone-duo-decisions]].
