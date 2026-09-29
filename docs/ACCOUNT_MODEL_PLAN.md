# Personal, Workspaces, seats and billing — audit and plan

Status: **proposal, not implemented.** Written 2026-09-29 against commit `9d25368`. It answers the
"account, subscription, workspace, seat, guest, storage, AI and billing" specification in two parts:
what exists today (Phase 1) and how to get to the specified model (Phase 2 onwards).

## 1. What exists today (audit)

### 1.1 Personal is a workspace

- `workspaces.kind` is `"personal" | "team"` (`convex/schema.ts:57`). Every account gets a workspace
  row named "Personal" at sign-up (`users.bootstrap` → `seed.seedPersonalWorkspace`, `convex/seed.ts:53`),
  stored as `profiles.defaultWorkspaceId`, with the owner as a `workspaceMembers` row (role `owner`).
- **Personal workspaces can take members**: `workspaces.invite` doesn't check `kind`; the switcher shows
  "Personal · Ada" / "Shared by Ada". (UI copy "Your personal workspace stays private" is wrong.)
- Nothing "personal" exists outside a workspace. Every content table requires `workspaceId`: folders,
  tags, documents, blocks, snapshots, tasks, collections, comment threads/comments, document grants,
  public links, files, stars, recents, `recentHidden` (`schema.ts:102-640`). Search indexes filter on
  `workspaceId`. Change feeds use `workspaces.changeSeq`.
- About **50 server functions** take a `workspaceId` (37 public), **~70 web call sites** pass one, and the
  **Mac app** syncs one workspace at a time (SQLite `workspace_id`, cursor per workspace).
- The active workspace is client state (`localStorage["folevi:workspace"]`); URLs don't carry it.
- There is no user-facing "delete workspace".

### 1.2 Plans and billing

- Plans live in one place, `convex/lib/plans.ts`: `free | basic | pro`, prices **already match** the
  spec (Basic $2/mo · $9/yr, Pro $5/mo · $49/yr), 1 / 20 / 100 GB, 2 devices on Free, AI on Pro, 7-day
  Pro trial for new accounts. Web re-exports it.
- **No workspace plans at all** (no Team, Business, seats or quantity). Checkout hard-codes quantity 1.
- `subscriptions` has one row per **profile** (`schema.ts:313`); `payments` per profile.
- Provider: **Stripe** over raw `fetch` (`convex/billing.ts`): Checkout, customer portal, signed webhook
  (HMAC, 5-minute tolerance). **No event-id dedupe**: subscription events are last-write-wins; invoices are
  deduped by invoice id only. Not configured in production (the UI shows "Coming soon").
- Scattered plan-name checks in ~20 places (web settings, device limit, switcher pill, admin, Mac).

### 1.3 Storage, devices, AI

- **Storage is pooled**: a person's plan limit is checked against the sum of every workspace they own,
  personal and team (`convex/lib/billing.ts:21-27`), and team uploads count against the *owner's*
  personal plan. Each workspace also has its own 5 GB `storageQuotaBytes` (so Pro users hit 5 GB first).
- **Devices**: per account, from the personal plan (`convex/lib/devices.ts`). Matches the spec.
- **AI**: gated by the caller's personal plan everywhere, including inside team workspaces (Personal Pro
  leaks into workspaces; a paid workspace can't grant AI). Usage is per profile per day, analytics only;
  fair-use limit 150 requests/hour.

### 1.4 Roles, sharing, guests

- Workspace roles: `owner | admin | editor | commenter | viewer`. Access levels: read / comment / write /
  manage. Page grants (`documentPermissions`: editor/commenter/viewer) are inherited by child pages.
- **Guests exist in all but name**: a person with a page grant and no membership can reach only granted
  pages (and children). All workspace-wide lists (documents, search, tasks, folders, members, export,
  sync pull, AI) call `requireWorkspace` and refuse non-members. Tested (`sync-routing`, `cross-workspace`).
- Gaps:
  - sharing only works with **existing, verified accounts** (no email invite for new people);
  - no Guests list, no member → guest conversion;
  - **leaks to guests**: `collections.get` returns every workspace member's name; `documents.get` returns
    the page's folder and tag names; `sharing.get` shows other grant holders to any reader;
  - only owners/admins can share pages in normal (non-restricted) mode;
  - `acceptInvite` doesn't re-check the member limit.
- Settings are grouped "You" / "Workspace" but every section shows to every role.
- Account deletion hands a team workspace to the first admin/editor; otherwise (and always for Personal)
  it **purges the workspace, including other people's content**.

### 1.5 Conflicts with the specification

| Spec rule | Today |
|---|---|
| Personal is not a workspace | Personal **is** a workspace row, can have members |
| Workspace subscriptions, per seat | None; all billing is per person |
| Storage separate | Pooled across owned workspaces |
| AI separate | Personal plan decides AI in every workspace |
| Roles Owner / Admin / Member / Guest | owner / admin / editor / commenter / viewer; guests implicit |
| Guests only see shared content | Mostly true; three metadata leaks |
| Idempotent webhooks | Subscription events not deduped |
| "Storage counts across your personal and team workspaces" | Present (settings, plan features, pricing FAQ, terms, admin) |
| Admin billing access configurable | No workspace billing exists |

## 2. Target model

- **Scope** everywhere: `{ kind: "personal", profileId } | { kind: "workspace", workspaceId }`.
- **Content rows** (documents, folders, tags, tasks, collections, blocks, snapshots, comment threads,
  files, stars, recents, public links, grants…): `ownerProfileId` (personal) **xor** `workspaceId`
  (workspace). Convex has no CHECK constraints, so this is enforced by one write helper
  (`scopeFields(scope)`), a schema-level static test, and a verification query run after migration.
  Indexes: every `by_workspace_*` index gets a `by_owner_*` twin; search indexes filter on both fields.
- **Personal change feed**: `profiles.personalChangeSeq` (workspace keeps `changeSeq`).
- **Plans**: one catalog (`convex/lib/plans.ts`) with `scope`, `billingModel` (`free | flat_user |
  per_seat`), ids `personal_free`, `personal_basic_monthly|yearly`, `personal_pro_monthly|yearly`,
  `workspace_free`, `workspace_team_monthly|yearly`, `workspace_business_monthly|yearly`, prices exactly
  as specified, and entitlements per plan.
- **Subscriptions**: the existing table gains `ownerType: "user" | "workspace"`, `workspaceId?`,
  `planId`, `quantity`; personal rows keep `profileId`. Exactly one of `profileId` / `workspaceId`.
  Existing rows migrate to `personal_*` ids (no new table).
- **Resolvers** (`convex/lib/entitlements.ts`, `convex/lib/permissions.ts`): `personalEntitlements`,
  `workspaceEntitlements`, `resolveEntitlements(scope)`, `canUseAI(scope)`, `canUpload(scope, bytes)`,
  `billableSeatCount(workspaceId)`, `canManageWorkspace / Members / Billing`, `canInviteMember / Guest`,
  plus the existing `documentAccess` extended to personal content. Nothing merges the two scopes.
- **Roles**: `owner | admin | member` memberships (+ `canManageBilling` on admins, default off); guests
  = page grants without membership, now first-class (list, email invites, conversion).
- **Seats**: active owner + admin + member rows; guests and pending invites are free. Seat changes
  schedule a single "sync quantity" action that sets the Stripe quantity to the *current* count
  (idempotent, so duplicate or racing triggers converge), with Stripe proration.
- **Storage**: `profiles.personalStorageUsedBytes` vs `workspaces.storageUsedBytes`, each checked only
  against its own plan. Over quota → uploads/imports/duplication blocked, nothing deleted.
- **AI**: personal context → personal plan; workspace context → workspace plan. `aiUsage` gains
  `scope` + `workspaceId?`.
- **Billing**: Stripe stays (no Polar integration exists). Webhook events deduped by `event.id` in a new
  `billingEvents` table; stale events ignored by comparing Stripe's `created` timestamp.

## 3. Delivery plan

Each phase ships on its own, green (typecheck, lint, Convex + web unit tests, full Playwright suite,
production build) before the next starts.

**Phase A — plans, storage and AI scoping, copy (no data move).** Central plan catalog with scopes and
ids; capability checks instead of plan-name checks; personal quota counts only the personal workspace;
team workspaces get their own plan (Workspace Free) and quota; AI in a team workspace follows the
workspace plan; remove the pooled-storage copy everywhere; personal billing page shows only
Free/Basic/Pro with the new heading and copy; webhook event dedupe. *Fixes most user-visible conflicts
fast, before the risky part.*

**Phase B — Personal is not a workspace (data migration).**
1. Widen schema: optional `ownerProfileId`, optional `workspaceId`, new `by_owner_*` indexes,
   `personalChangeSeq`, `personalStorageUsedBytes`. Deploy.
2. Scope-aware server: every function takes a `scope` instead of `workspaceId`; reads work for both old
   (personal-workspace) and new rows during the migration window.
3. Take a production backup (`npx convex export --prod --include-file-storage`).
4. Batched, idempotent backfill per personal workspace: move rows to `ownerProfileId`, move counters,
   convert any collaborators in someone's Personal to page grants (guests) on what they could reach,
   then delete the personal workspace and its membership rows. A verification query must report zero
   rows with both or neither owner field before step 5.
5. Remove compatibility code and `defaultWorkspaceId`; tighten validators.
6. Web: context switcher (Personal first, then Workspaces with role labels), context-aware Home,
   search, tasks, trash, export and settings.

**Phase C — Workspace plans, seats and billing.** Workspace plan & billing page (Free / Team /
Business, monthly/yearly, seats × price, guests "not billed", renewal, manage/cancel), Stripe per-seat
checkout and quantity sync, billing permission for admins, end-of-period downgrade, over-limit state.

**Phase D — Members vs guests.** Roles collapse to owner/admin/member (+ billing flag); Guests list;
guest email invites for people without an account (pending share → grant on sign-up/accept); member ↔
guest conversion; fix the three guest metadata leaks; editors can share pages they can edit; role-based
settings visibility; delete workspace; ownership rules for leaving and account deletion (require
transfer or deletion instead of purging other people's content).

**Phase E — tests and final audit** (the 35 scenarios in the spec, as Convex tests plus Playwright for
the UI paths), then the codebase sweep listed in the spec.

**Later — Mac app.** It syncs one workspace at a time and would stop seeing Personal after Phase B. It
isn't distributed yet and Mac work is paused, so it's updated in the Mac catch-up.

## 4. Decisions (made 2026-09-29)

- **Workspace entitlements, flat per workspace:** Free 5 GB, no AI · Team 100 GB, AI Assistant for
  members · Business 1 TB, AI with higher fair-use limits. Member and guest counts unlimited on all
  plans for now (flags exist so limits can be added later).
- **Roles:** editor / commenter / viewer members all become **Members** (billable). Editors get full
  Member rights; commenters and viewers keep a "can comment" / "view only" member restriction, so nobody
  silently gains permissions.
- **Collaborators in someone's Personal** become **page guests** on the notes they could reach.
- **Delivery:** all phases in sequence. Phase A ships to `main`; Phases B–E are built and tested on the
  `account-model` branch (local migration run) and reach production only after a backup and an explicit
  go-ahead, because that code expects migrated data.
- **Business tier:** until audit logs / analytics / security controls exist per workspace, Business
  differs only by real limits (storage, AI) and billing controls; marketing lists only what exists.

## 4a. Open questions (original)

1. **Workspace entitlements** (storage, AI, limits) for Free / Team / Business.
2. **Existing editor / commenter / viewer members**: map to Member (editor) and keep "comment/view
   only" as a member-level restriction, or convert them to guests.
3. **Collaborators in someone's Personal** (production today: 2 accounts, 2 personal workspaces, 1 team
   workspace, 29 notes): convert to page grants (guests) or into a new team workspace.
4. **Business tier honesty**: audit logs, workspace analytics, security controls and advanced
   permissions don't exist per workspace today. Until built, Business can only differ by limits (storage,
   AI, members) and billing controls; marketing must say only what's real.

## 5. Risks

- Phase B touches most of the backend and the web data layer; it's the riskiest change so far. Mitigated
  by staging, dual-read code, a backup, a verification query and the full Playwright suite.
- Stripe per-seat prices must be created in the Stripe dashboard (Team/Business × month/year) and set as
  Convex env vars by the account owner.
- The Mac app breaks for Personal content after Phase B until its catch-up.
