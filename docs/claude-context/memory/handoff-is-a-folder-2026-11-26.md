# The handoff is a folder, not one file (owner, 2026-11-26)

The owner, after two days of pull requests conflicting in `HANDOFF.md`: "yes, set that up so it stops recurring".

- `HANDOFF.md` is frozen and never changes (it becomes a short pointer once no branch still adds to it). On a pull
  request CI's first step (`node scripts/handoff.mjs check --base HEAD^1`) fails when the file differs from main's.
- After every change: `node scripts/handoff.mjs log "<what changed>" --area <area>` makes a file of its own in
  `handoff/log/`; fill it in. Update `handoff/state/<area>.md` when the area's state or next steps changed.
- Read with `node scripts/handoff.mjs show` (or `--area <area>`); the lasting guide is `handoff/guide.md`.
- Never edit another session's log entry. A state file says what is true now; history goes in the log.

**Why:** every session appended to the same lines of one file, so each merged pull request made every other open one
conflict and run CI again; 20 were stuck on 2026-11-25. A new file can't conflict with anything.

**How to apply:** a branch started before 2026-11-26 that added to `HANDOFF.md`: after merging `main`, take main's
`HANDOFF.md` (`git checkout origin/main -- HANDOFF.md`) and move what the branch had added into a log entry and its
area's state file. Details: `handoff/README.md`.
