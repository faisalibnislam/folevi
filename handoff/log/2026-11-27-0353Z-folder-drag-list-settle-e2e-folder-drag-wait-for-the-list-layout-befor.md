# E2E folder-drag: wait for the List layout before dragging a note

- Date: 2026-11-27 03:53 UTC
- Area: web
- Branch: claude/folder-drag-list-settle

`e2e/folder-drag.spec.ts` ("mouse: notes onto folders...") failed on shard 4 for PRs 165, 170 and 171. The cause was not the sidebar More change: PR 171's run didn't include it. The trace shows the test read the first row's title and pressed the mouse 125 ms after clicking List, while the notes were still redrawing. So it dragged "Welcome to Folevi" while expecting "Trip Sketch: Coastal Weekend" in Shelf.

The test now waits for List to be checked and for the row to stop moving (`untilSettled`) before it reads the title and drags. Typecheck and lint pass. It wasn't run locally because another session held the backend ports, so CI is its check.
