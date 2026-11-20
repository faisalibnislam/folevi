---
name: editor-quality-bar-2026-11-19
description: "Owner's 2026-11-19 answers on the note editor: where it hurts, size target, how deep fixes may go"
metadata:
  node_type: memory
  type: project
  originSessionId: 54fa431a-5c5e-42e1-97f0-9a28d4eff6f6
  modified: 2026-11-19T05:33:14.573Z
---

On 2026-11-19 the owner asked for a full audit of the note editor ("rock solid") and answered these in a question dialog:

- All four areas still bother them: speed (typing, scroll, long notes), caret/selection/keys, paste/format/undo, rich blocks.
- They notice it most on **iPhone and iPad** (not Mac or the browser), so WebKit and touch are the main test target.
- A note of about 2,000 blocks (roughly 50 pages) must stay smooth. 10,000+ is not a target.
- Typing tests: English and Latin only (no IME or right-to-left for now).
- Fixes may restructure editor code deeply, but the **stored note format must not change** (no migration, older app versions keep working).
- Working mode they picked: fix confirmed bugs as I go with a test each, one report at the end; stop only for choices that change behavior or looks. Parallel audit agents are OK for big jobs like this.

**Why:** the editor is shared by web, Mac, iPhone and iPad, and earlier audits (docs/EDITOR_AUDIT_2026-11-12.md) were run only in Chromium and never measured large notes.

**How to apply:** for editor work, test in WebKit at phone and tablet sizes first, check a 2,000-block note, and never change the saved format without bringing a plan. See [[ios-native-look-decisions]].
