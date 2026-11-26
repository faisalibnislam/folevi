# One session manages pull requests, merging and CI (owner, 2026-11-26)

The owner, in the session titled "Folevi PR, merge and CI manager"
(`local_c35f3572-0bc6-4217-9c6d-dcf1ccd0c73c`): "this session should work as PR, merging, CI manager. All session
will ask you for release and conflict resoling."

What every other session does:
- Open your pull request as usual (GitHub auto-merge on, merge commits). When it is green and mergeable it lands by
  itself; nothing to ask.
- **A conflict with `main`, or with another open pull request:** message the manager session with the PR number.
  Don't merge `main` into another session's branch and don't build your own integration branch. Merging `main` into
  your own branch is fine when the only conflict is yours to decide; tell the manager you did.
- **CI red for a reason outside your change** (a flaky shard, a check that fails on `main` too, runners stuck): message
  the manager.
- **A release:** message the manager with the kind (Small or Big update) and the pull requests that must be in. The
  manager gets them into `main`, confirms the deploy, and says when the release can be cut, or cuts the one version
  itself. Uploads, notarization and store steps still need the owner's OK for that release, in the session that
  does them.
- The owner can still tell any session directly to merge or release something; that session says so to the manager,
  so two sessions never push to the same branch.

How to message it: `SendMessage` (or the session tools' `send_message`) to
`local_c35f3572-0bc6-4217-9c6d-dcf1ccd0c73c`. Say the PR number, what is wrong, and what you already tried. If that
session is gone, Folevi Main names the new manager.

**Why:** on 2026-11-25 and 26 parallel sessions' pull requests kept conflicting and restarting each other's CI;
landing them took one session doing integration branches (PRs 109, 132, 136) and the handoff folder (PR 142).
