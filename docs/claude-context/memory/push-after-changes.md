---
name: push-after-changes
description: "Commit finished changes locally, but never push or deploy until the user explicitly says so (pushing main = Vercel deploy)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-14T06:49:17.853Z
---

Commit each completed, tested change locally, but do NOT push to `origin main` (or deploy anything: no `convex deploy`, no Vercel deploys) until the user explicitly says to. Repo: https://github.com/faisalibnislam/folevi (PUBLIC since 2026-09-28).

**Why:** On 2026-10-05 the user said "don't deploy anything until I explicitly say so from now on". Pushing to main triggers a Vercel production deploy (and Convex deploy), so a push IS a deploy. This replaces the earlier rule (2026-09-28: "push to Github and always keep up to date").

Reaffirmed 2026-10-14: "don't push everything as you go on GitHub, create big changes and then push only when needed. Otherwise my Vercel cost will pile up." Every push is a paid Vercel build, so batch: one push for a large body of work, only when the user asks.

**How to apply:**
- After a change: commit locally, then tell the user it's ready and not deployed. Push only when they say "push"/"deploy"/"make it live".
- Pushing to the local dev backend (`npx convex dev --once`) for testing is fine; it's not production.
- Scan for secrets before committing; never commit `.env*` (except `.env.example`) or keys. `.claude/` is gitignored.
- Pushes use a repo-local credential helper that reads the **faisalibnislam** token from the gh keyring, because the gh CLI's active account is faisal-upmerch (work). Don't switch the active gh account.
- Never force-push. [[web-only-until-told]] still limits what I change.
- The repo is public: don't commit personal data, internal notes, or anything that shouldn't be public.
- For gh commands that need owner rights, use `GH_TOKEN="$(gh auth token --user faisalibnislam)" gh ...`.
- End commit messages with the Claude co-author line.
