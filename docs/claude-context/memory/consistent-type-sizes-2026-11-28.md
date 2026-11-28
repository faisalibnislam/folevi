---
name: consistent-type-sizes-2026-11-28
description: "Owner, 2026-11-28: the same kind of text is the same size and style everywhere (timestamps, counts, names); consistency is very important"
metadata:
  type: feedback
---

The same kind of text looks the same everywhere in Folevi. A card's time ("Oct 20", no "Edited" word) is one size on a note card and a folder card (--type-card-time, 80.5% of Footnote); names, counts and dates follow one type system across cards, lists and screens, and across web and the native apps where the design is shared. The owner said "consistency is very important" on 2026-11-28 after seeing the note card's Edited date at 7px next to the folder card's at 10.5px.

**Why:** mismatched sizes for the same role make the app look unfinished, and the owner reviews visual details closely.

**How to apply:** before adding or changing a text style, check how the same role is styled elsewhere (note and folder cards, list rows, Home sections, native cards) and reuse one token or class (`text-footnote`, `.ui-list-name`, `.ui-list-meta`, `WebTextStyle.role(...)`) instead of a one-off size. When fixing one instance, fix every sibling in the same change. The list views' system is in globals.css (`.ui-list*`).
