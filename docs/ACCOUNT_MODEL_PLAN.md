# Personal, Workspaces, seats and billing — audit and plan

Status: **Phase A shipped; Phases B, C and D implemented on the `account-model` branch** (the
production migration run is next — see the runbook in §3a). Written 2026-09-29 against
commit `9d25368`. It answers the
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

*As built (server, part 1):* steps 1, 2 and 4 are one change. There is no dual-read window: the new code
reads Personal only by `ownerProfileId` and refuses any workspace of kind "personal", so it is deployed
with the site in read-only maintenance and the migration runs right after (§3a). Content tables carry
`ownerProfileId` xor `workspaceId`, written only through `insertScoped` (`convex/lib/scope.ts`); every
public function that took a `workspaceId` for content takes a `scope`
(`{ kind: "personal" } | { kind: "workspace", workspaceId }`, Personal always the caller's own);
`profiles.personalChangeSeq`, `personalStorageUsedBytes` and `personalDocumentCount` are Personal's
counters; `users.bootstrap` seeds Personal directly; `workspaces.mine` lists team workspaces only;
`documentAccess` gives the owner `manage` on their Personal and everyone else only page grants (guests).
`defaultWorkspaceId` and `workspaces.kind` stay in the schema until step 5.

*As built (web, part 2):* step 6. The web app's active context is `{ kind: "personal" } | { kind:
"workspace", … }` (`apps/web/src/lib/app/state.tsx`, remembered as `folevi:context`; an older
`folevi:workspace` value becomes the setting if it's still one of your team workspaces, else Personal —
the default). Every list, search, task, AI and export call passes the context's `scope`; documents open by
id from any context, and folder actions show only for pages of the current context. The switcher lists
Personal (your name and plan) first, then Workspaces with your role; Settings has a "You" group and, only
in a workspace, that workspace's group (General, Members, Import & export). The sync engine routes new
pages by scope and re-stamps page creates queued by older builds (the old personal workspace → Personal);
the local database (v3) keys its document cache by scope and keeps the queue and waiting uploads.

**Phase C — Workspace plans, seats and billing.** Workspace plan & billing page (Free / Team /
Business, monthly/yearly, seats × price, guests "not billed", renewal, manage/cancel), Stripe per-seat
checkout and quantity sync, billing permission for admins, end-of-period downgrade, over-limit state.

*As built (Phase C):*
- **Rows.** `subscriptions` and `payments` hold both kinds: `ownerType` ("user" | "workspace"; unset on
  older rows = user) and exactly one of `profileId` / `workspaceId`, written only through
  `insertSubscription` / `insertPayment` (`convex/lib/billing.ts`; a static test forbids other inserts).
  Personal rows keep `plan` (tier); workspace rows store `planId`, `quantity` (billed seats),
  `stripeSubscriptionItemId`, `currentPeriodStart`, `paymentMethod`. Indexes `by_workspace`,
  `by_owner_type`, `payments.by_workspace_created`. Existing Personal rows are unchanged.
- **Seats** (`convex/lib/seats.ts`): every membership role counts (owner, admin, and today's
  editor/commenter/viewer "members"); guests, pending invitations, removed people and suspended/deleted
  accounts count 0. *Suspended workspaces keep their count* (suspension is a temporary platform action; an
  admin changes or cancels the plan if billing should stop). Every membership change (accept, remove,
  leave, role change, transfer, account suspension or deletion) calls `seatsChanged`: test/manual plans
  store the new count at once; Stripe plans set `seatSyncScheduledAt` and schedule one
  `workspaceBilling.syncSeatQuantity` (5 s later), which reads the current count and updates the Stripe
  subscription item (`proration_behavior=create_prorations`) only when Stripe's quantity differs —
  duplicates and races converge (a mark older than 15 minutes counts as lost). A subscription event whose quantity differs from the count schedules a
  sync too (e.g. members joined while Checkout was open, or a quantity edited in Stripe).
- **Entitlements.** `workspaceEntitlements` reads the workspace's row: in force while active, past due
  (Stripe's retry schedule is the grace; when Stripe gives up it cancels or marks the subscription unpaid,
  which we treat as ended), or canceled but paid through the period; else Workspace Free. Team: AI +
  100 GB; Business: AI with higher fair use + 1 TB; an admin storage override still wins.
- **Permission.** `canManageWorkspaceBilling` (`convex/lib/permissions.ts`): the owner, or an admin with
  `workspaceMembers.canManageBilling` (set by the owner in Members; cleared when they stop being admin
  or ownership moves). Every function in `convex/workspaceBilling.ts` checks it on the server.
- **Functions.** `workspaceBilling.summary`, `testPurchase` (not in production), `checkout` (quantity =
  seats, `client_reference_id` `ws:<id>`, metadata `workspaceId`), `portal`, `changePlan` (Team ↔
  Business, monthly ↔ yearly, prorated), `cancel` / `resume` (period end); `workspaces.setBillingManager`;
  admin `adminBilling.setWorkspacePlan` (provider "manual", reason + audit). The webhook routes a
  workspace's events (by stored subscription id, `ws:` reference or metadata, or customer) to
  `applyWorkspaceStripeEvent`; access is granted only there. The hourly `settleExpiredPlans` also moves
  expired manual/test workspace plans to Workspace Free. Purging a workspace stops its subscription
  renewing.
- **Web.** Settings → (workspace) Plan & billing (`/settings/workspace-billing`, listed only for people
  who can manage billing; "Not found" otherwise); seats and the per-seat note in Members; "Can manage
  billing" switch for admins; "Owner · Team" in the switcher; over-limit notices; admin workspace page
  shows plan, seats and payments and can set the plan. The public pricing page keeps "Coming soon" until
  `WORKSPACE_PLANS[*].available` is flipped once Stripe is configured.

*Stripe setup for workspace plans (account owner):* create a product per plan with recurring **per-unit**
prices — Team $5/month and $49/year, Business $10/month and $99/year — and set
`STRIPE_PRICE_WS_TEAM_MONTH`, `STRIPE_PRICE_WS_TEAM_YEAR`, `STRIPE_PRICE_WS_BUSINESS_MONTH`,
`STRIPE_PRICE_WS_BUSINESS_YEAR` on Convex. The webhook endpoint (`<convex-site>/webhooks/stripe`) must
send `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`,
`invoice.payment_failed`, `charge.succeeded` (payment method line) and `charge.refunded`. Optionally
create a customer-portal configuration for workspaces that lists only the workspace prices and doesn't
allow quantity edits, and set its id as `STRIPE_PORTAL_CONFIG_WS`.

**Phase D — Members vs guests.** Roles collapse to owner/admin/member (+ billing flag); Guests list;
guest email invites for people without an account (pending share → grant on sign-up/accept); member ↔
guest conversion; fix the three guest metadata leaks; editors can share pages they can edit; role-based
settings visibility; delete workspace; ownership rules for leaving and account deletion (require
transfer or deletion instead of purging other people's content).

*As built (Phase D):*
- **Roles.** Memberships are `owner | admin | member`; a member has `workspaceMembers.memberAccess`
  (`edit` — unset — `comment` or `view`), admins keep `canManageBilling`. The role validator still accepts
  `editor | commenter | viewer`, and `normalizeMembership` (`convex/lib/auth.ts`) reads them as member +
  edit / comment / view, so the code is correct before and after `migrations:normalizeWorkspaceRoles`
  rewrites the rows (memberships and invitations; batched, idempotent). Nothing writes the old names;
  `invite` / `changeRole` still accept them from older clients and store member + access. Checks use a
  single "level" (`view < comment < edit < admin < owner`, `requireWorkspace(…, "edit")`). Every
  membership role is a seat (`lib/seats.ts`).
- **Permissions** (`convex/lib/permissions.ts`, with the matrix at the top of the file):
  `canManageWorkspace` (owner/admin: settings, guests, export), `canManageWorkspaceMembers` /
  `canManageMember` (admins manage members, only the owner manages admins), `canInviteMember`,
  `canInviteGuest` (owner, admin, member who can edit), `sharePermissions` / `canShareDocument`,
  `memberCanManageBilling`, `canExportWorkspace`, `requireWorkspaceManager`.
- **Sharing.** Page managers (Personal: its owner; workspace: owners, admins, and the creator of a
  restricted page) control the access mode, public links and anyone's grants. Members who can edit share a
  non-restricted page they can edit with anyone, up to "Can edit", and change or remove only the grants
  and invitations they made. Guests never share.
- **Guest leaks fixed.** `collections.get` gives a guest only the people the page already involves (its
  creator, the people it's shared with, people named in rows they can see) — never the member list;
  `documents.get` gives a guest no folder, tag or home-folder names and no parent they can't open;
  `sharing.get` shows a guest only their own access, the page's owner and who shared it. Workspace search
  refuses non-members: guests find shared pages in Shared with Me (no separate guest search).
- **Page invitations** (`pageInvites`, scoped like the page). Sharing with an address without a verified,
  active account stores a hashed-token invitation (14 days) and sends the existing `share_notification`
  email with `/share-invite/<token>` as its link (no new template; its footer says "share emails are turned
  on for your Folevi account", slightly off for someone without one). Up to 50 pending per page; rate
  limit `invite`. It grants nothing and costs nothing; `users.bootstrap` puts an "Accept and open" notice
  in a new account's bell. Accepting needs the same verified address and re-checks that the sender may
  still share that page at that level. The Share dialog lists pending invitations with Revoke;
  housekeeping expires them.
- **Guests list** (`/settings/workspace-guests`, owners/admins; `workspaces.guests`): guests, their pages
  and access (change per page), Remove (every grant here), Convert to member (a member invitation; on
  accept they're a member, one seat, and keep their grants), plus pending page invitations.
- **Member → guest** (`workspaces.convertMemberToGuest`): the membership ends (one seat less); they keep
  every grant they already had, and get a grant at their former access (view → Can view, comment → Can
  comment, else Can edit) on each page they created (up to 200, not in Trash) — except pages that are
  restricted, under a restricted page, or have a restricted page (or more than 200 pages) under them, since
  a grant there would open restricted content. Nobody gains access.
- **Settings by role.** General and Members for everyone (members read); Guests and Import & export for
  owners/admins (`exports.exportScope` refuses members for a workspace); Plan & billing for billing
  managers. No Security/Permissions/Sharing pages (nothing to put there yet). Hidden pages opened by URL
  say "Not found".
- **Deleting a workspace** (owner, type its name): `workspaces.deletionScheduledFor` + a `deletionJobs` row
  of kind "workspace" 7 days out. Meanwhile it's hidden from members and guests (not found everywhere,
  including their grants) and read-only for the owner, who can cancel (`cancelDeletion`); members get an
  access-change notice (bell + `access_changed` email); pending member invitations are revoked; a paid plan
  is set to end with its period (`workspaceClosing`; canceling the deletion doesn't resume it — resume in
  Plan & billing). `maintenance.runDeletionJobs` then purges it (a job whose workspace is no longer
  scheduled is marked canceled).
- **Leaving, account deletion.** The sole owner can't leave (the error and General explain: transfer or
  delete). `users.requestAccountDeletion` refuses while you own a workspace other people are in
  (`users.deletionBlockers` lists them in Settings → Security); owned workspaces nobody else is in are
  purged with the account. If someone joined during the grace period (or support scheduled the deletion),
  the purge hands the workspace to its longest-standing admin, else member, and tells them — it never
  deletes other people's work. Removing a member never touches their Personal or subscription.

**Phase E — tests and final audit** (the 35 scenarios in the spec, as Convex tests plus Playwright for
the UI paths), then the codebase sweep listed in the spec.

**Later — Mac app.** It syncs one workspace at a time and would stop seeing Personal after Phase B. It
isn't distributed yet and Mac work is paused, so it's updated in the Mac catch-up.

## 3a. Phase B runbook (production migration)

Production today: 2 profiles, 2 personal workspaces, 1 team workspace, 29 documents. The migration is
written for any size (batched, self-continuing) and is idempotent: every step can be run again.

What `migrations:migratePersonalWorkspaces` does, one personal workspace at a time
(`convex/migrations.ts`):

1. **Guests.** Every collaborator (member other than the owner) gets page grants on what they could open
   — editor/admin → editor, commenter → commenter, viewer → viewer. A grant reaches every page under its
   page, so a page gets one only when nothing under it was less open to that person (restricted pages
   they couldn't open stay closed; a restricted page they created becomes an editor grant; grants they
   already had are kept). Nobody gains access; a page whose subtree holds something they couldn't open
   is left out (logged as `migration.personal_guest_gaps`, to re-share by hand if wanted).
2. **Move.** Every row in every content table with that `workspaceId` moves to the owner's Personal
   (`ownerProfileId` set, `workspaceId` removed) — `seq` values unchanged, so change order is kept. Its
   notifications lose the workspace (invitation notices are deleted with the invitations), its AI usage
   rows become Personal.
3. **Finish.** `changeSeq` → `profiles.personalChangeSeq`, `storageUsedBytes` →
   `personalStorageUsedBytes`, `documentCount` → `personalDocumentCount`, an admin storage quota on the
   old workspace → the owner's `subscriptions.storageOverrideBytes`; memberships and the workspace row are
   deleted; then `defaultWorkspaceId` is cleared on every profile.

Steps (run from a checkout of the approved `account-model` commit, with production credentials):

1. **Read-only.** Admin console → Maintenance → turn on read-only with a banner ("Folevi is being
   updated; your changes wait on this device"). Writes are refused server-side (`assertWritable`).
2. **Backup** (includes uploaded files):
   `npx convex export --prod --include-file-storage --path backups/folevi-prod-$(date +%Y%m%d-%H%M).zip`
   and check the ZIP opens and lists every table.
3. **Deploy** the backend: `npx convex deploy` (schema: optional `workspaceId`, new `ownerProfileId`
   fields and `by_owner*` indexes; existing rows stay valid). Deploy the web app from the same commit.
4. **Migrate:** `npx convex run --prod migrations:migratePersonalWorkspaces`. It continues itself; watch
   the logs (`npx convex logs --prod`) until the scheduled `migrations:*` runs stop.
   Then (Phase D) `npx convex run --prod migrations:normalizeWorkspaceRoles`: rewrites editor → member,
   commenter → member (comment), viewer → member (view) on memberships and invitations. Nobody's access
   or seat count changes (the code already reads the old names that way), so it's safe at any time after
   the deploy; it continues itself and can be run again.
5. **Verify:** `npx convex run --prod migrations:verifyAccountModel`. It must return `ok: true` with
   every count 0: rows with both/neither owner field, rows left in a personal workspace, rows outside
   their document's scope, orphaned grants, personal workspaces, profiles with a default workspace, and
   memberships or invitations still holding an old role (`legacyRoles`).
   Spot-check in the app: each account's Personal has its notes; the team workspace is unchanged.
6. **Lift read-only.**

**Rollback** = restore the backup: redeploy the previous backend commit (`main`) and the previous web
build, then `npx convex import --prod --replace-all backups/<file>.zip`. Anything written after the
backup is lost, which is why the site stays read-only from step 1 until verification passes. The
migration never deletes content (only the emptied workspace rows, their memberships and invitations).

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
- Phase B has no dual-read window: between deploying and migrating, Personal looks empty. The runbook
  keeps the site read-only through that window (minutes at production's size).
- A Personal change stamps the owner's profile row (`personalChangeSeq`). Every query that reads the
  profile (most do, through `requireProfile`) re-runs on each Personal edit — the same fan-out a workspace
  edit already had through the workspace row. If it shows up in costs, the counter can move to its own
  table without changing the protocol.
- Collaborators in someone's Personal keep access only to pages whose whole subtree they could open;
  pages mixing open and restricted sub-pages are reported by the migration for manual re-sharing.
