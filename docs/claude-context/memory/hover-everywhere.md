---
name: hover-everywhere
description: "Every button and clickable control shows a visible hover effect, on the web, the Mac and the iPad with a pointer"
metadata:
  type: feedback
---

Every button, icon button, menu trigger, segmented choice, row action, chip, tab and clickable row in Folevi must show a visible hover effect, everywhere: web, Mac, and iPad with a pointer. The owner, 2026-11-06: "please make sure all buttons show hover effect everywhere. Double check. Literaly everywhere. Make this as your rule." (Seen on the Foli DNA toolbar icons.)

**Why:** a control with no hover feels dead and unpolished.

**How to apply:** build controls from the shared pieces that carry the hover (web: `.ui-btn-*`, `.ui-input`, `.ui-seg`, `--glass-hover`; native: `WebIconButton`, `WebButton`, `listHoverTint`, `WebHoverRowStyle`). A bare `<button>` or `.buttonStyle(.plain)` needs its own hover. On every UI change, check the hover of each control on the screen, not just the one touched. Related: [[no-os-default-controls]].
