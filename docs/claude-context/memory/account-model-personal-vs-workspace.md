---
name: account-model-personal-vs-workspace
description: "User's account/billing spec (2026-09-29) — Personal is NOT a workspace; per-seat Workspace plans; decisions taken and delivery rules"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-09-29T03:42:41.660Z
---

On 2026-09-29 the user gave a long spec: Personal must not be a workspace (no hidden personal workspace row), Personal plans belong to users (Free / Basic $2·$9 / Pro $5·$49), Workspace plans belong to workspaces and bill per active seat (Free / Team $5·$49 per member / Business $10·$99 per member), guests are free and resource-scoped, and storage and AI are separate per scope. The audit and plan are in `docs/ACCOUNT_MODEL_PLAN.md`.

**Decisions the user chose:**
- Workspace storage is flat per workspace:
  - Free: 5 GB, no AI.
  - Team: 100 GB, with AI.
  - Business: 1 TB, with AI and higher fair-use limits.
- Editor, commenter and viewer members all become Members (billable seats). Commenter and viewer keep a comment-only or view-only restriction, so nobody gains permissions.
- Collaborators in someone's Personal become page guests.
- Run all phases (A–E) in sequence, then report. Stop only before the production data migration.

**Status 2026-09-29:**
- Phases A–E are all built on branch `account-model` (draft PR faisalibnislam/folevi#9, "do not merge").
- Tests: 225 Convex, 95 web unit, and 94/95 e2e (the one failure is the known flaky account.spec:160).
- The local migration succeeded on 4,690 test accounts.
- **Production migrated 2026-09-29 ~14:30.** PR #9 was merged (a1a0a63), migratePersonalWorkspaces + normalizeWorkspaceRoles ran, and the verifier reported ok:true. The backup is in `backups/folevi-prod-before-account-model-20260929-1424.zip`, which is gitignored. Use `--deployment fastidious-clownfish-123`, never `--prod`: `--prod` resolved to the local backend. (Old note:) Production was not migrated yet. The runbook is in `docs/ACCOUNT_MODEL_PLAN.md` §3a (read-only → backup → merge/deploy → migratePersonalWorkspaces + normalizeWorkspaceRoles → verifyAccountModel/accountModelReport → lift read-only). It waits for the user's go-ahead.
- Post-migration cleanup list: §3b. Mac follow-ups: §3c.
- Running Convex data migrations from my shell gets blocked by the auto-mode classifier, so the user runs them.

**Why:** the user wants a mental model like Notion's billing, but without Notion's "Personal is a workspace".

**How to apply:**
- Never reintroduce a personal workspace or a fake workspace id.
- Phase A ships to main.
- Phases B–E live on the `account-model` branch until the user approves a production backup and the migration.
- Stripe stays as the billing provider; there is no Polar.
- Business must only advertise features that exist.
- Related: [[production-setup-status]], [[web-only-until-told]].
