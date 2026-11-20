---
name: e2e-verify-through-a-pr
description: "How to verify Folevi's full Playwright suite without deploying: CI runs on pull requests; local runs differ (AI key on the dev backend)"
metadata:
  node_type: memory
  type: reference
  originSessionId: 54fa431a-5c5e-42e1-97f0-9a28d4eff6f6
  modified: 2026-11-19T16:46:33.697Z
---

Folevi's CI (`.github/workflows/ci.yml`) runs on `pull_request` as well as on pushes to `main`. A PR from a
branch runs the whole end-to-end suite (8 shards, local Convex, no AI key) without deploying production, so it
is the way to prove the suite green before asking the owner to push `main`.

Local runs (`cd apps/web && E2E_NO_SERVER=1 npx playwright test ... --project account`, with the `web-3000`
preview server up) go against the shared dev Convex deployment, which has an AI key. Specs that expect
"isn't set up" (ai-study, ai-agent, ai-find-todos, ai-page, ai-panel-height, ai-research) and admin's revenue
table fail locally for that reason only. A failure screenshot can show another test's page: contexts a passed
test left open in the same worker are captured too.

CI's e2e jobs only start after the first job passes, so a red "generated files" step hides every browser
failure (it did from 18 to 19 November 2026). Two shards hitting the 45 minute limit means many failing tests
there, not a slow runner.

GitHub auto-merge is off for the repo and `main` has no branch protection (checked 2026-11-19), so "merge when
green" means waiting on the run yourself (`gh run watch <id>` in the background) and then `gh pr merge <n> --merge
--match-head-commit <full sha>`. Every push to the PR branch cancels the run in progress and starts a new one
(about 25 to 45 minutes), so batch doc commits. Merging is a push to `main` (production deploy): owner's OK needed.

Related: [[other-sessions-share-this-repo]], [[editor-quality-bar-2026-11-19]].
