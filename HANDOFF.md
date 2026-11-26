# Folevi: handoff

Read this first if you are a Claude (or any agent) picking this project up.

The handoff is a folder now, not this file, so sessions working at the same time never edit the same file:

1. `handoff/guide.md`: what Folevi is, where it lives, setup, architecture, build and test, release, secrets,
   rules and gotchas (the numbered sections 1 to 8 and 11 that used to be here).
2. `handoff/state/<area>.md`: the current state and next steps of one area (`node scripts/handoff.mjs areas`).
   Read `release.md` and the areas you will touch.
3. `node scripts/handoff.mjs show`: the state files and the newest log entries in one read
   (`--area mac` for one area, `--last 30` for more entries).

After every change:

- `node scripts/handoff.mjs log "<what changed>" --area <area>`, then fill in the file it makes in `handoff/log/`.
- Update your area's `handoff/state/<area>.md` when its current state or next steps changed.
- Never add to this file, and never edit another session's log entry. CI fails a pull request that changes this
  file (`node scripts/handoff.mjs check`).

How it works and why: `handoff/README.md`. Everything written here before 2026-11-26 is in `handoff/archive/`.
