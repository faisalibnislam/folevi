# Personal, Workspaces, seats and billing: audit and plan

Status: **Phase A shipped; Phases B–E implemented on the `account-model` branch** (the production
migration run is next; see the runbook in §3a; the cleanups that follow it are in §3b). Written 2026-09-29 against
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

**Phase A: plans, storage and AI scoping, copy (no data move).** Central plan catalog with scopes and
ids; capability checks instead of plan-name checks; personal quota counts only the personal workspace;
team workspaces get their own plan (Workspace Free) and quota; AI in a team workspace follows the
workspace plan; remove the pooled-storage copy everywhere; personal billing page shows only
Free/Basic/Pro with the new heading and copy; webhook event dedupe. *Fixes most user-visible conflicts
fast, before the risky part.*

**Phase B: Personal is not a workspace (data migration).**
1. Widen schema: optional `ownerProfileId`, optional `workspaceId`, new `by_owner_*` indexes,
   `personalChangeSeq`, `personalStorageUsedBytes`. Deploy.
2. Scope-aware server: every function takes a `scope` instead of `workspaceId`; reads work for both old
   (personal-workspace) and new rows during the migration window.
3. Take a production backup (`npx convex export --deployment <prod-deployment> --include-file-storage`).
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
`folevi:workspace` value becomes the setting if it's still one of your team workspaces, else Personal
(the default). Every list, search, task, AI and export call passes the context's `scope`; documents open by
id from any context, and folder actions show only for pages of the current context. Open tabs (and where the Home tab
leads) are kept per context, and switching context from a page, folder or tag opens the new context's Home. The switcher lists
Personal (your name and plan) first, then Workspaces with your role; Settings has a "You" group and, only
in a workspace, that workspace's group (General, Members, Import & export). The sync engine routes new
pages by scope and re-stamps page creates queued by older builds (the old personal workspace → Personal);
the local database (v3) keys its document cache by scope and keeps the queue and waiting uploads.

**Phase C: Workspace plans, seats and billing.** Workspace plan & billing page (Free / Team /
Business, monthly/yearly, seats × price, guests "not billed", renewal, manage/cancel), Stripe per-seat
checkout and quantity sync, billing permission for admins, end-of-period downgrade, over-limit state.

*Billing update (2026-09-30, January 2027 plans): this section describes Phase C as first built, with
Stripe and the Free / Team / Business tiers. Since then:* the plans are Free, Core, Pro and Pro AI for both
Personal and Team (Team priced per member seat); storage is a shared 1 GB free pool per owner (their
Personal on Free plus every free workspace they own) or 20/50 GB per person on paid plans (in a paid
workspace, per member); AI is metered in credits per person per scope (a member's seat in a paid
workspace, otherwise the person's own Personal, including in free workspaces and as a guest), and Core
has no AI at all; Polar replaced Stripe (checkout with seats, customer portal for the payer, Standard
Webhooks at `/webhooks/polar`, seat sync by `PATCH subscriptions/{id} {seats}`); `stripe*` fields on
subscription rows are legacy and never written. `migrations:migratePlanTiers` rewrote the stored tiers
from before (Basic → Core, Pro → Pro AI, Team → Pro, Business → Pro AI) on production on 2026-09-30;
the migration, its report and the old values were then removed from the schema and code. The current
rules and the owner's Polar checklist are in `docs/BILLING.md`; read "Stripe" below as "Polar" and "Team / Business" as the
paid plans.

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
  subscription item (`proration_behavior=create_prorations`) only when Stripe's quantity differs, so
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
prices (Team $5/month and $49/year, Business $10/month and $99/year) and set
`STRIPE_PRICE_WS_TEAM_MONTH`, `STRIPE_PRICE_WS_TEAM_YEAR`, `STRIPE_PRICE_WS_BUSINESS_MONTH`,
`STRIPE_PRICE_WS_BUSINESS_YEAR` on Convex. The webhook endpoint (`<convex-site>/webhooks/stripe`) must
send `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`,
`invoice.payment_failed`, `charge.succeeded` (payment method line) and `charge.refunded`. Optionally
create a customer-portal configuration for workspaces that lists only the workspace prices and doesn't
allow quantity edits, and set its id as `STRIPE_PORTAL_CONFIG_WS`.

**Phase D: Members vs guests.** Roles collapse to owner/admin/member (+ billing flag); Guests list;
guest email invites for people without an account (pending share → grant on sign-up/accept); member ↔
guest conversion; fix the three guest metadata leaks; editors can share pages they can edit; role-based
settings visibility; delete workspace; ownership rules for leaving and account deletion (require
transfer or deletion instead of purging other people's content).

*As built (Phase D):*
- **Roles.** Memberships are `owner | admin | member`; a member has `workspaceMembers.memberAccess`
  (`edit` when unset, `comment` or `view`), admins keep `canManageBilling`. The role validator still accepts
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
  creator, the people it's shared with, people named in rows they can see), never the member list;
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
  comment, else Can edit) on each page they created (up to 200, not in Trash), except pages that are
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
  is set to end with its period (`workspaceClosing`; canceling the deletion doesn't resume it; resume in
  Plan & billing). `maintenance.runDeletionJobs` then purges it (a job whose workspace is no longer
  scheduled is marked canceled).
- **Leaving, account deletion.** The sole owner can't leave (the error and General explain: transfer or
  delete). `users.requestAccountDeletion` refuses while you own a workspace other people are in
  (`users.deletionBlockers` lists them in Settings → Security); owned workspaces nobody else is in are
  purged with the account. If someone joined during the grace period (or support scheduled the deletion),
  the purge hands the workspace to its longest-standing admin, else member, and tells them. It never
  deletes other people's work. Removing a member never touches their Personal or subscription.

**Phase E: tests and final audit** (the 35 scenarios in the spec, as Convex tests plus Playwright for
the UI paths), then the codebase sweep listed in the spec.

*As built (Phase E):*

**Spec scenarios → tests.** Every scenario has a Convex test (`tests/convex/…`) that checks it on the
server; Playwright specs (`apps/web/e2e/billing.spec.ts`, `workspace-billing.spec.ts`, `guests.spec.ts`,
`switcher.spec.ts`, `devices.spec.ts`) cover the UI paths on top. Tests marked *(E)* were added or
strengthened in Phase E.

| # | Scenario | Test (file › name) |
|---|---|---|
| 1 | Personal Free limits | `account-scopes` › "Free: 1 GB personal storage, 2 devices, no AI"; "personal storage excludes workspace storage, and workspace storage excludes personal" (the 1 GB upload limit); `billing` › "Free allows 2 devices: a third is held (and refused) until one signs out" |
| 2 | Basic limits | `account-scopes` › "Basic: 20 GB personal storage, unlimited devices, no AI"; `billing` › "the Pro trial, Basic and Pro have unlimited devices; upgrading frees a held device" |
| 3 | Pro limits | `account-scopes` › "Pro: 100 GB personal storage, unlimited devices, AI in Personal" |
| 4 | Pro user joins a Free workspace → stays Free | `account-scopes` › "a Pro user joining a Free workspace: the workspace stays Free, with no AI and 5 GB" |
| 5 | Free user in a Business workspace | `account-scopes` › "a Free user in a Business workspace: Business inside it, Free in Personal (5)" |
| 6 | Pro user in 10 workspaces: none Pro | `account-scopes` › "a Pro user in ten workspaces: none become Pro" |
| 7 | Owner upgrades workspace: Personal unchanged | `workspace-billing` › "an owner upgrading a workspace leaves their Personal unchanged (7)" |
| 8 | Guest with Edit on one note can edit it | `members-guests` › "8, 9, 10: a guest edits a granted page, can't open other pages by URL, and takes no seat"; `sync-routing` › "a guest with an editor grant edits a page in someone else's Personal through their own queue" |
| 9 | Same guest, unrelated note by URL → denied | `members-guests` › "8, 9, 10: …"; `personal-scope` › "a page grant makes a guest: the page and its nested pages, nothing else"; *(E)* `sweep-security` › "an op id reused for someone else's page or block returns nothing of it" |
| 10 | Guest consumes no seat | `workspace-billing` › "guests and pending invitations are free; accepting adds a seat; removing takes one away (10–13)"; `members-guests` › "8, 9, 10: …" |
| 11 | Pending invite consumes no seat | `workspace-billing` › "… (10–13)"; `members-guests` › "pending grants nothing and costs nothing; the new account is told and accepting creates the grant" (page invitations) |
| 12 | Accept → seat +1 | `workspace-billing` › "… (10–13)" |
| 13 | Remove → seat −1 | `workspace-billing` › "… (10–13)" |
| 14 | Member → Admin unchanged | `workspace-billing` › "member → admin and admin → member don't change seats (14, 15)" |
| 15 | Admin → Member unchanged | same test |
| 16 | Member → Guest −1 | `members-guests` › "16: a member made a guest loses the seat and keeps pages they created or were given (never restricted content)"; `workspace-billing` › "member → guest takes a seat away; guest → member adds one once they accept (16, 17)" |
| 17 | Guest → Member +1 after activation | `members-guests` › "17: a guest invited to become a member takes a seat only once they accept, and keeps their pages"; `workspace-billing` › "… (16, 17)" |
| 18 | Basic 8 GB → Free: files stay, uploads blocked until < 1 GB | `account-scopes` › "Basic with 8 GB moving to Free: files stay, uploads wait until under 1 GB (18)" |
| 19 | Workspace over downgraded storage | *(E)* `workspace-billing` › "a workspace whose paid plan ends while it holds more than Free allows keeps everything; only growth is blocked (19)" (Team → Free holding 40 GB: uploads refused for everyone; reading, writing, filing and export still work; uploads return under the limit); `account-scopes` › "a workspace over its storage keeps its content; growth is blocked; an admin override replaces the limit (19)" |
| 20 | Personal AI usage recorded as personal | `account-scopes` › "Personal requests are recorded as personal; workspace requests against their workspace" |
| 21 | Workspace AI usage recorded against the workspace | same test |
| 22 | Personal storage excludes workspace storage | `account-scopes` › "personal storage excludes workspace storage, and workspace storage excludes personal"; "a member's uploads count toward the workspace, not anyone's personal storage"; `billing` › "personal storage counts only Personal, against the Personal plan (team workspaces never add to it)" |
| 23 | Workspace storage excludes personal | `account-scopes` › "personal storage excludes workspace storage, and workspace storage excludes personal" |
| 24 | Personal → workspace → Personal: no leakage | `account-scopes` › "switching Personal → workspace → Personal leaks nothing either way (24)"; `personal-scope` › "Personal and workspace rows never mix in lists (switching scopes)" |
| 25 | Only authorized roles access workspace billing | `workspace-billing` › "the owner, and admins the owner allows; never members or guests"; *(E)* `sweep-security` › "its public links stop working and its billing can't be revived; canceling the plan still works" |
| 26 | No workspaces: Personal works | `personal-scope` › "a user with no workspaces uses Personal normally (26)" |
| 27 | Member removed: Personal and subscription intact | `members-guests` › "27: removing a member never touches their Personal or their own subscription" |
| 28 | Personal subscription cancelled: memberships intact | `workspace-billing` › "canceling a Personal plan leaves workspace plans and memberships alone (28)" |
| 29 | Workspace subscription cancelled: Personal intact | `workspace-billing` › "canceling a workspace plan ends it at the period's end, and leaves Personal alone (29)" |
| 30 | Ownership transfer: subscription stays | `workspace-billing` › "transferring ownership keeps the subscription on the workspace (30)" |
| 31 | Guest search returns only permitted content | `members-guests` › "31: a guest's search never reaches the workspace (they find shared pages in Shared with Me)"; `ai` › "the AI only ever reads notes the person can open"; *(E)* `sweep-security` › "a guest on a Team workspace's page doesn't get the workspace's AI (nor does their Pro cover it)" |
| 32 | Personal Free device limit | `billing` › "Free allows 2 devices: a third is held (and refused) until one signs out"; `account-scopes` › the test below |
| 33 | Workspace membership doesn't bypass the device limit | *(E)* `account-scopes` › "Free allows 2 devices, and joining a workspace (even a paid Business one) doesn't lift it" |
| 34 | Duplicate webhook → state correct | `billing` › "a redelivered event is applied once, so the state stays correct (scenario 34)"; `workspace-billing` › "checkout, subscription and invoices land on the workspace; a redelivered event applies once (34)"; *(E)* `billing` › "invoice events in any order: a late failure never undoes a payment or a refund, and a partial refund isn't a refund" |
| 35 | Two members accept simultaneously → quantity correct | `workspace-billing` › "two members accepting at the same moment: the quantity is right (35)"; "with Stripe: accepts are gathered into one sync that sets Stripe's quantity to the current count; repeats are harmless (35)" |

**Sweep findings and fixes** (all server-side; each has a test in `tests/convex/sweep-security.test.ts`
unless noted):

- *Guest privilege escalation.*
  - Sync replay leaked any page or block by id: re-sending one's own op id with another page's or block's
    id returned that page's summary or the block's content. A replay now answers only for the same entity
    and kind (`invalid_op` otherwise) and never returns what the caller can no longer open; re-sending a
    create after losing access returns nothing (`lib/syncEngine.ts` `replay`, `createDoc`).
  - A guest could move a shared page's sub-page to the workspace's top level (in effect a top-level page),
    re-file pages into the workspace's folders, or change its tags. Guests may now only re-parent under
    pages they can edit; folder changes, top-level moves and tag changes need membership (`updateDoc`,
    `organization.setDocumentTags`).
  - Anyone with only edit access (e.g. a grant inside a restricted page) could move a page out from under a
    restricted page, opening it to the whole workspace. That now needs manage access.
  - `documents.deletePermanently` / `restoreFromTrash`: "I created it" was enough, even after removal or
    being made view-only. Now current write access is needed (manage, or the creator with edit); no access
    reads as `not_found`.
  - `files.urls` trusted the client's clock (`now`), so a link could be minted for decades and outlive
    access. The server clamps it (links last ≤ ~2 h) and `verifyFileSignature` refuses any link claiming
    more than 9 days. Workspace export ZIPs are linked only for the person who made them (they hold
    restricted pages); loose files of a workspace being deleted only for its owner.
  - Public links kept serving a workspace scheduled for deletion; they stop now (and come back if the
    deletion is canceled).
  - A guest on a Team/Business workspace's page could use the workspace's AI plan. Workspace AI is for
    members only now (`ai.begin`).
  - Link labels: anyone could put a link to any page id in their own notes and learn each new title on
    rename. Labels are refreshed only for blocks last written by someone who can open the page.
- *Frontend-only checks.* Every role-gated control has a server check; the one exception was billing on
  a workspace scheduled for deletion (hidden in the UI, allowed by the server): buying, changing and
  resuming a plan and the portal are refused now (`requireWorkspaceBilling(…, { write: true })`);
  canceling still works.
- *Webhooks* (test in `billing.test.ts`). Events without an id are refused (400) instead of being applied
  without dedupe; a late `invoice.payment_failed` no longer turns a paid invoice into a failure or marks
  the plan past due after a newer subscription event; a redelivered `invoice.paid` no longer undoes a
  refund; a partial refund (`refunded: false`) no longer marks the payment refunded; invoices without an
  id aren't recorded (`lib/billing.ts` `invoicePaymentStatus`, `failedInvoiceMarksPastDue`).
- *Seat math.* Counting was already only in `lib/seats.ts`, but the "at least one seat" rule was repeated
  in three places and the charge (seats × price) in four, and the summary's estimate could disagree with
  the stored quantity while the owner was suspended. `billedQuantity` / `seatChargeCents` (`lib/plans.ts`,
  re-exported by `lib/seats.ts`) and `billableQuantity` are the only ones now, used by the summary, test
  purchases, checkout, seat sync, webhooks, admin revenue and the web billing and admin pages.
- *Plan-name checks.* The workspace plan cards decided "paid" and "AI" by tier name; they read the
  catalog now (`isPaidPlan`, `entitlements.aiAssistant`). The remaining tier comparisons are labels,
  validators or `paidSince` continuity, not capability gates.
- *Personal as a workspace, pooling, leaks between scopes.* None found outside the migration and the
  compatibility guards listed in §3b. Personal Pro never reaches a workspace (AI, storage, devices), no
  workspace plan reaches Personal, storage and AI are counted per scope (the admin dashboard's platform
  total adds both, as a platform figure only), guests and pending invitations never count as seats.
- *Wording.* No "personal workspace" or pooled-storage copy was left in the product. Fixed: terms and
  privacy (below), the docs page (new "Workspaces & plans", account deletion, Mac shortcuts), the pricing
  FAQ (device example without the Mac app, guests free, who can export a workspace), the security and Mac
  pages ("workspace" where Personal or notes were meant), the account-deletion email (it said owned
  workspaces would be deleted; only ones nobody else uses are), the invite email's example role, and the
  `PRODUCT`, `SECURITY`, `ADMIN`, `DEPLOYMENT`, `README`, `DESIGN_SYSTEM` and `SYNC_PROTOCOL` docs.
- *Terms and Privacy* (dated 29 September 2026): Personal vs workspaces; Personal plans per person;
  workspace plans belong to the workspace, billed per member seat (guests and pending invitations free,
  prorated); storage and AI separate (workspace AI for members; fair use); nothing deleted on a downgrade;
  workspace content belongs to the workspace and its owner and admins control and export it; leaving, the
  sole-owner rule, 7-day workspace deletion; account deletion blocked while you own a workspace others
  use; no native app claimed. The spec's card copy "Web, Mac and iOS" is shown as "On the web · Mac app
  coming soon" (`AVAILABILITY`), and Business is described by what exists ("more room and AI"), not
  "advanced controls".

**Migration at any size.**
- `migrations:verifyAccountModel` starts a background job and returns at once. Each run
  (`verifyAccountModelRun`, an action) reads at most 10 pages of 500 rows through queries (so it never
  conflicts with live writes), adds its counts to a `migrationReports` row and schedules the next run. A
  run only saves if the row is still at the stage and cursor it started from, so a duplicate run can't
  count a page twice. `migrations:accountModelReport` returns the latest report: `done`, `ok` (only when
  done and every count is 0), the counts, per-table details, and what it's reading while it runs.
- `migratePersonalWorkspace`: the grants step stops starting new page trees after 250 pages and resumes in
  the same batch (`skip`); one tree is capped at 1,000 pages, reading children with `take` rather than an
  unbounded `collect` (a bigger tree gets no grants and is logged); collaborators are read with a cap.
  The finish step deletes memberships in batches and moves the counters in the same mutation that deletes
  the workspace, so they move exactly once. `clearDefaultWorkspaces` (200 per batch) and
  `normalizeWorkspaceRoles` (200 per batch) were already bounded, resumable and idempotent.
- Test: `migration` › "at scale every step runs in bounded batches, resumes, and the check needs many
  runs": a 301-page tree, 25 more top-level pages, 450 old-style memberships and 250 profiles with a
  default workspace: several grants steps (one resumed inside a batch), several move, role and profile
  batches, and a check over small pages that needs more than 10 runs and agrees with one over big pages.

**Later: Mac app.** It syncs one workspace at a time and would stop seeing Personal after Phase B. It
isn't distributed yet and Mac work is paused, so it's updated in the Mac catch-up.

## 3a. Phase B runbook (production migration)

> **Done on production (2026-09-29).** `verifyAccountModel` reported `ok`; roles normalized (`legacyRoles`
> 0); no profile has a default workspace; no personal workspace remains. The migration code
> (`migratePersonalWorkspaces`, `normalizeWorkspaceRoles`, …) and its test have since been removed (§3b);
> this runbook is kept as a record.

Production before the migration: 2 profiles, 2 personal workspaces, 1 team workspace, 29 documents. The migration is
written for any size (batched, self-continuing) and is idempotent: every step can be run again.

What `migrations:migratePersonalWorkspaces` does, one personal workspace at a time
(`convex/migrations.ts`):

1. **Guests.** Every collaborator (member other than the owner) gets page grants on what they could open
   (editor/admin → editor, commenter → commenter, viewer → viewer). A grant reaches every page under its
   page, so a page gets one only when nothing under it was less open to that person (restricted pages
   they couldn't open stay closed; a restricted page they created becomes an editor grant; grants they
   already had are kept). Nobody gains access; a page whose subtree holds something they couldn't open
   is left out (logged as `migration.personal_guest_gaps`, to re-share by hand if wanted).
2. **Move.** Every row in every content table with that `workspaceId` moves to the owner's Personal
   (`ownerProfileId` set, `workspaceId` removed), with `seq` values unchanged, so change order is kept. Its
   notifications lose the workspace (invitation notices are deleted with the invitations), its AI usage
   rows become Personal.
3. **Finish.** `changeSeq` → `profiles.personalChangeSeq`, `storageUsedBytes` →
   `personalStorageUsedBytes`, `documentCount` → `personalDocumentCount`, an admin storage quota on the
   old workspace → the owner's `subscriptions.storageOverrideBytes`; memberships and the workspace row are
   deleted; then `defaultWorkspaceId` is cleared on every profile.

Steps (run from a checkout of the approved `account-model` commit, with production credentials):

Always name the deployment (`--deployment <prod-deployment>`, e.g. `fastidious-clownfish-123`) rather than
`--prod`: in a checkout whose `.env.local` points at a local backend, `--prod` can resolve to that local
deployment and silently run there instead.

1. **Read-only.** Admin console → Maintenance → turn on read-only with a banner ("Folevi is being
   updated; your changes wait on this device"). Writes are refused server-side (`assertWritable`).
2. **Backup** (includes uploaded files):
   `npx convex export --deployment <prod-deployment> --include-file-storage --path backups/folevi-prod-$(date +%Y%m%d-%H%M).zip`
   and check the ZIP opens and lists every table.
3. **Deploy** the backend: `npx convex deploy` (schema: optional `workspaceId`, new `ownerProfileId`
   fields and `by_owner*` indexes; existing rows stay valid). Deploy the web app from the same commit.
4. **Migrate:** `npx convex run --deployment <prod-deployment> migrations:migratePersonalWorkspaces`. It continues itself; watch
   the logs (`npx convex logs --deployment <prod-deployment>`) until the scheduled `migrations:*` runs stop (the dashboard's
   Schedules page shows what's still pending). Every step is bounded and idempotent: if one fails, run the
   command again.
   Then (Phase D) `npx convex run --deployment <prod-deployment> migrations:normalizeWorkspaceRoles`: rewrites editor → member,
   commenter → member (comment), viewer → member (view) on memberships and invitations. Nobody's access
   or seat count changes (the code already reads the old names that way), so it's safe at any time after
   the deploy; it continues itself and can be run again.
5. **Verify:** `npx convex run --deployment <prod-deployment> migrations:verifyAccountModel` starts the check in the background
   (it returns a `reportId` at once). Then run `npx convex run --deployment <prod-deployment> migrations:accountModelReport` until
   it says `done: true` (while running it shows `reading: "<table>"` and partial counts). It must say
   `ok: true`, with every count 0: rows with both/neither owner field (`rowsWithBothScopes`,
   `rowsWithNoScope`), rows left in a personal workspace (`rowsInLegacyWorkspaces`), rows outside their
   document's scope, orphaned grants, personal workspaces, profiles with a default workspace, and
   memberships or invitations still holding an old role (`legacyRoles`); `tables` has the per-table
   details. A given check: `npx convex run --deployment <prod-deployment> migrations:accountModelReport '{"reportId":"<id>"}'`.
   Spot-check in the app: each account's Personal has its notes; the team workspace is unchanged.
6. **Lift read-only.**

**Rollback** = restore the backup: redeploy the previous backend commit (`main`) and the previous web
build, then `npx convex import --deployment <prod-deployment> --replace-all backups/<file>.zip`. Anything written after the
backup is lost, which is why the site stays read-only from step 1 until verification passes. The
migration never deletes content (only the emptied workspace rows, their memberships and invitations).

## 3b. After production is migrated: remove the compatibility code

Production was migrated and verified on 2026-09-29 (`accountModelReport` `ok: true`, `legacyRoles` 0, no
profile with a default workspace, no personal workspace; every remaining workspace row still stores
`kind: "team"`).

**Done (the clean-up commit after the migration).**
- `profiles.defaultWorkspaceId` is gone from the schema (no production row held it), with the account
  purge's clearing of it and the test assertion.
- `workspaces.kind`: nothing reads or writes it any more; every personal-workspace guard is gone
  (`lib/auth.ts` requireWorkspace, `lib/permissions.ts`, `lib/syncEngine.ts` memberScope,
  `workspaces.ts`, `users.ts`, `admin.ts` (the list reads `by_created`; `kind` left the admin responses),
  `adminBilling.ts`, `billing.ts`, `maintenance.ts`), `seed.ts` no longer writes it, and the `by_kind`
  index is gone. The field stays in the schema as `v.optional(v.literal("team"))` ("being removed") because
  production rows still hold it.
- Stored member roles are owner | admin | member only: `vWorkspaceRole` lost editor / commenter / viewer,
  `normalizeMembership` lost its legacy branch, `isLegacyRole` and the legacy `BILLABLE_ROLES` keys are
  gone. **Kept on purpose:** `vInviteRole` and `requestedRole` still accept editor / commenter / viewer as
  *input* (stored as member + access) because the paused Mac app sends them. Remove after the Mac
  catch-up.
- The Phase B and D migrations (`migratePersonalWorkspaces`, `migratePersonalWorkspace`, the grants /
  move / finish steps, `clearDefaultWorkspaces`, `normalizeWorkspaceRoles`) and
  `tests/convex/migration.test.ts` are removed; the legacy-role test became a member-access test.
- `verifyAccountModel` / `accountModelReport` stay as an integrity check over every scoped table: exactly
  one of `ownerProfileId` / `workspaceId`, the workspace exists (`rowsInMissingWorkspaces`), the row is in
  its document's scope, no orphaned grant. The personal-workspace, default-workspace and legacy-role stages
  are gone. `migrationReports.counts` / `tables` are now name → number records (older reports keep their
  old names and still validate), and starting a check keeps only the latest 5 reports
  (`REPORTS_KEPT`).
- One-off, batched, self-continuing migrations `migrations:dropWorkspaceKind` (unset `kind`) and
  `migrations:backfillAccountDefaults` (wrote `subscriptions.ownerType`, "workspace" for a row with a
  workspace and no person, else "user"; then `aiUsage.scope`, "workspace" with a workspace, else
  "personal"), plus `migrations:refreshLinkingPages` (re-derives the excerpt, preview, search text and
  task titles of every page that links to another page, see §3d; kept). Tests:
  `tests/convex/account-cleanup.test.ts`.

**Done in production on 2026-09-29**, in this order: `dropWorkspaceKind` (1 workspace),
`backfillAccountDefaults`, `refreshLinkingPages`, then `verifyAccountModel` → `ok: true`. Afterwards no
`workspaces` row had `kind`, no `subscriptions` row lacked `ownerType` and no `aiUsage` row lacked
`scope`, so the follow-up commit:
- deleted `workspaces.kind` from `convex/schema.ts`;
- made `subscriptions.ownerType` and `aiUsage.scope` required, and dropped the "unset = user / personal"
  readings (`convex/lib/billing.ts` `isPersonalSubscription`, `convex/lib/entitlements.ts`
  `personalAiUsage`, `convex/adminAnalytics.ts`);
- removed `dropWorkspaceKind` and `backfillAccountDefaults` and their tests.

A backend whose data never ran them (an old local dev backend) now fails the schema push; reset its data
(`pnpm exec convex dev` against a fresh local deployment) or fix the rows in its dashboard.

**Left for later.**
- `workspaces.storageQuotaBytes` as an implicit admin override (`convex/lib/entitlements.ts`
  `workspaceStorageOverride`): move any non-default value to `storageQuotaOverrideBytes`, then keep the
  field only as the value shown to older clients, or remove it.
- *A few weeks after the migration* (once no browser can still hold pre-migration data), web
  compatibility with older local data, kept for now: the old `folevi:workspace` key
  (`apps/web/src/lib/app/state.tsx`, `LEGACY_WORKSPACE_KEY`), the v3 cache rebuild
  (`apps/web/src/lib/sync/db.ts` upgrade), `adoptLegacyCreates` (`apps/web/src/lib/sync/engine.ts`,
  re-stamping page creates queued by older builds) and old offline snapshots listing Personal as a
  workspace (`apps/web/src/lib/app/offlineSnapshot.ts`, filters `kind: "personal"` from device data).
- *After the Mac catch-up:* the old role names in `vInviteRole` / `requestedRole`, and the older
  `document.workspaceId` field on page creates (`convex/lib/syncEngine.ts` `createScopeArg`).

## 3c. Mac follow-ups (not changed here; for the Mac catch-up)

- Personal is a scope, not a workspace: the Mac syncs one workspace at a time (SQLite `workspace_id`, a
  cursor per workspace) from `workspaces:mine`, which no longer lists Personal. It must sync Personal as
  `{ kind: "personal" }` and each workspace by scope (`docs/SYNC_PROTOCOL.md`), and key its database by
  scope.
- Roles: send `member` + `memberAccess` or `admin` (not editor / commenter / viewer); show Owner / Admin /
  Member and guests; `APIModels.swift:167` treats "editor" as an access word.
- Plans: read capabilities (`entitlements.ai`, `storageBytes`, `devices`) rather than tier names
  (`APIModels.swift:67-83`); the Personal plan only under "You"; workspace plan, seats and billing only for
  the owner and billing admins; workspace AI from the workspace's plan, for members only.
- Guests: pages shared from other scopes (Shared with Me); no workspace-wide browsing for guests; no
  top-level moves, folder moves or tags for guests (the server refuses them now).
- Workspace deletion (read-only for the owner, hidden for others), ownership transfer, the sole-owner
  rule for leaving, and account-deletion blockers.

## 3d. Remaining gaps

**Closed (the clean-up commit; `tests/convex/privacy-gaps.test.ts`, a view-only / restricted member and a
guest):**
- *Counts.* `tasks.counts`, the folder and tag counts, folder previews and "updated" dates in
  `organization.index`, `organization.draftCount` and `documents.trashSummary` (`total` and `deletable`)
  count only pages the caller can open. `PageReader` (`convex/lib/auth.ts`) resolves the caller's standing
  once: in their Personal or as owner / admin everything is open without extra reads; for a member a page
  outside any restriction is open, and only pages under a restricted page go through `documentAccess`
  (restriction walks and verdicts cached per call). Bounds are unchanged (`take(1000)` tasks, `take(2000)`
  per folder / tag, `take(5000)` drafts, 501 trashed pages).
- *Ids.* `Placement` (`convex/lib/documents.ts`) gives every page summary (`documents.get` / `list` /
  `children` / `recent` / `recentNotes` / `duplicate` / `daily`, sync push results and `sync.pull`) a
  `folderId` only for someone in the page's scope (never a guest) and a `parentDocumentId` only when the
  reader can open that parent (so a member granted one page under a restricted page doesn't get its id
  either).
- *Link labels.* Stored labels are never served as they are (`convex/lib/linkLabels.ts`): `blocks.list`,
  `blocks.deleted`, `sync.pull`, sync push results, version previews (`documents.snapshotContent`),
  exports and the AI's note text rewrite every page link (page blocks' `titleCache` / `iconCache`, inline
  and table-cell `pageLink` labels) to the target's current title and icon when the reader can open it,
  and to "Page you can't open" (no icon) otherwise. Text everyone reading a page sees (its excerpt, card
  preview, search text, task titles) and public links use a target's title only when it's in the same
  scope and not under a restricted page. The rename path (`refreshLinkLabels`) no longer writes a title
  into a page unless that holds (and the block's last writer can open the target).
  `migrations:refreshLinkingPages` recomputes text derived before this change (§3b).

**Still open:**
- A guest of a page (or a visitor of its public link) sees, in its excerpt / preview (public link: in its
  links), the titles of *unrestricted* pages in the same Personal or workspace that it links to, even ones
  they can't open. Restricted titles never appear. Closing it would need per-reader derived text.
- Stored labels in blocks still hold whatever their writer saw (they're only rewritten when served).
  Duplicating a page or restoring a version copies them as stored; they're served relabeled like any
  other block.
- Pro and the pricing cards say "Unlimited AI Assistant" (the spec's copy) while a fair-use limit applies
  (150 requests an hour); the terms say fair-use limits apply.
- Workspace AI for guests is now refused; if the product owner wants guests to use a paid workspace's AI
  on the pages shared with them, that's a one-line change in `ai.begin`.
- The Playwright suites weren't run in this phase (the Convex tests cover each scenario on the server).

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
- The change counters have since moved to their own table (`scopeCounters`, see docs/SYNC_PROTOCOL.md):
  stamping the profile or workspace row re-ran nearly every query on each edit.
- Collaborators in someone's Personal keep access only to pages whose whole subtree they could open;
  pages mixing open and restricted sub-pages are reported by the migration for manual re-sharing.
