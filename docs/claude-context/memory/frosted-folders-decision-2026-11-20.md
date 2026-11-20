---
name: frosted-folders-decision-2026-11-20
description: "Owner's 2026-11-20 picks for the folder/note card redesign (Frosted folders, 25% smaller on Mac+web, new sidebar icon, release)"
metadata:
  node_type: memory
  type: project
  originSessionId: faff9733-6283-46b8-bc6b-ba4943e8f557
  modified: 2026-11-20T05:48:10.435Z
---

Owner chose (AskUserQuestion, 2026-11-20) after the "Folevi folder states" artifact
(https://claude.ai/artifact/LxPzWN9JNK4FKuiqWDQgUD, source kept in the shared side-session notes):
- Folder style **Frosted** on web, Mac, iPhone, iPad: back with S-curve tab at 85% opacity, notes (today's
  note style: Spectral title, Created date, preview, art strip / spiral dots / ruled) fanned both ways
  behind a see-through frosted front (light blur), name + counts + "Edited" date on the front, app-style
  "…" chip only on hover/focus (always on touch). Subfolders: up to 2 whole folders stacked straight up
  behind, each a step higher and narrower, no names. Muted palette = folder color 84% into #9a9fab.
- **25% smaller** folder cards and note cards in grids on **Mac and web only**; iPad and iPhone keep sizes.
- Sidebar uses the new folder icon everywhere (page inside / stack for subfolders / outline when empty).
- Shipped as 1.5.58 on 2026-11-20 (PR 42): web, Mac (notarized) and TestFlight.

**Why:** owner reviewed many concepts in artifacts and converged on this.
**How to apply:** build on its own branch/worktree (other sessions release from the main checkout); see
[[mac-polish-rules-2026-11-18]] and [[note-page-and-tabs-rules-2026-11-18]] for related rules.
