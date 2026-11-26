# The handoff folder

Folevi's handoff used to be one file, `HANDOFF.md`, that every session appended to. Sessions work in parallel, so
every pull request edited the same lines, and each merge made every other open pull request conflict and run CI
again. On 2026-11-25 twenty pull requests were stuck that way. Since 2026-11-26 the handoff is this folder, where a
change adds a file of its own instead of editing a shared one.

| Where | What it holds | Who edits it |
| --- | --- | --- |
| `guide.md` | What rarely changes: what Folevi is, where it lives, setup, architecture, build and test, release, secrets, rules, gotchas. Sections keep their old numbers (1 to 8, 11), so "HANDOFF.md section 5" means section 5 here | Anyone, when the guide itself is wrong or out of date |
| `state/<area>.md` | One area's current state and next steps, kept short and true: rewrite it, don't append to it | The session working on that area |
| `log/<date>-<time>Z-<words>.md` | One file per change: what changed, what was checked, what is left | Only the session that made it |
| `archive/` | `HANDOFF.md`'s old "Current state", "Next steps" and "Change log" as they stood on 2026-11-26 | Nobody (frozen) |

`HANDOFF.md` at the repo root is a pointer to this folder and must not change. CI runs
`node scripts/handoff.mjs check`, which fails when anything is added to it.

## What to do

Starting work:

```bash
node scripts/handoff.mjs show                 # every area's state, then the newest log entries
node scripts/handoff.mjs show --area mac      # the Mac's and the release's state, and the Mac's entries
```

After every change, in the same pull request as the change:

```bash
node scripts/handoff.mjs log "What changed, in a few words" --area mac
```

It makes a file in `log/` named by the time, your branch and the title, and prints its path. Fill in what changed,
what was checked and how, and what is left. An entry about two areas takes `--area "mac, web"`. Then, when the
area's current state or next steps changed, update `state/<area>.md`.

## Rules

- Never add to `HANDOFF.md`. Never edit or delete another session's log entry; write a new one that corrects it.
- A state file says what is true now. When something stops being true, remove it; history lives in the log.
- One area, one state file. A new area is a new file in `state/` (the script reads the areas from the folder).
- Releases: record what went live, and how it was checked, in `state/release.md` and in a log entry.
- No em dashes, as everywhere in this repo (the check refuses them in `state/` and `log/`).

## Why this stops the conflicts

Two pull requests conflict when they change the same lines. A new file has no lines in common with anything, so
log entries can't conflict. State files can, but only when two sessions change the same area at once, and then
the conflict is a few lines in one small file rather than the whole handoff.
