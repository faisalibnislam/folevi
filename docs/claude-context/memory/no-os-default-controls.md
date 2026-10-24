---
name: no-os-default-controls
description: "Web UI must use Folevi's own controls (e.g. the custom Select), never OS-default dropdowns; notes show no emoji icons"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-09-26T04:34:52.675Z
---

All dropdowns on the web must be Folevi's own design (`apps/web/src/components/ui/Select.tsx`), never a native `<select>`/OS menu. Notes carry no emoji icon in the web UI (a plain document glyph where a marker is needed).

**Why:** the user (2026-09-26) asked that every dropdown be custom-designed, and asked to remove the note emoji system.

**How to apply:** when adding any picker/dropdown, use `Select` (tests pick options with the `pick()` e2e helper); don't reintroduce note emoji. Related: [[neutral-chrome-notes-carry-color]].
