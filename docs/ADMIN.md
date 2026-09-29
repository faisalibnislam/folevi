# Admin console

The operations console lives at `https://app.folevi.com/admin`. It is a separate area of the
web app (`apps/web/src/app/admin`, components in `apps/web/src/components/admin`) backed by
`convex/admin.ts`. This document covers who can do what, the safeguards on each action, what the
audit log records, how the first super admin is created, and what the console deliberately
does not do.

## 1. Principles

- **The server is the gate.** Every function in `convex/admin.ts` calls `requirePlatformRole`.
  People without a suitable role get `not_found` from every admin function, so the admin API
  looks like it doesn't exist. Hiding buttons in the UI is a convenience, not authorization.
- **No hint that the console exists.** `/admin` checks the role on the server
  (`admin.whoami`, in `app/admin/layout.tsx`) and returns the ordinary Next.js 404 to anyone
  without a role. Signed-out visitors are sent to `/signin?returnTo=/admin`. The page title
  stays "Folevi" until the role is confirmed. If a role is revoked mid-session, the client
  gate re-renders the same plain 404.
- **Metadata, never content.** There is **no document or note content viewer** anywhere in
  the console. The API doesn't provide one and the UI must not invent one. Admins see
  account metadata (email, auth subject and issuer, sessions, memberships), workspace names,
  counts and sizes. They never see document titles, blocks, comments, files or search
  results.
- **Every sensitive read or write is audited.** Reads that reveal identity data (user
  search, user view, workspace view, the email log) are Convex *mutations* so they can write
  an audit record. Every change requires a written reason.

## 2. Roles and permission matrix

Platform roles are stored on `profiles.platformRole`. There are three tiers, each including
everything below it. The stored names predate the labels and are kept so existing roles keep
working:

| Label         | Stored value    | In short                                                                                  |
| ------------- | --------------- | ----------------------------------------------------------------------------------------- |
| Owner         | `super_admin`   | Everything, including platform roles, refunds, maintenance mode and the full audit log.   |
| Admin         | `ops_admin`     | Account and workspace enforcement, plans, AI grants, storage, configuration and revenue.  |
| Support staff | `support_admin` | Look people up, resend emails, user-requested password resets, short trials and exports.  |

Platform roles are separate from workspace roles (owner, admin, member; guests are page grants without a
membership). A person's Personal is not a workspace and never appears in the workspace list.

| Capability                                               | Function(s)                                                                   | Owner | Admin | Support |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | :---: | :---: | :-----: |
| Open the console, dashboard (aggregates only)            | `whoami`, `dashboard`                                                         |   ✓   |   ✓   |    ✓    |
| Search and view users                                    | `searchUsers`, `viewUser`                                                     |   ✓   |   ✓   |    ✓    |
| Resend verification email                                | `resendVerification`                                                          |   ✓   |   ✓   |    ✓    |
| Start a user-requested password reset                    | `initiatePasswordReset`                                                       |   ✓   |   ✓   |    ✓    |
| Suspend / unsuspend a user                               | `suspendUser`                                                                 |   ✓   |  ✓¹   |         |
| Revoke all sessions                                      | `revokeAllSessions`                                                           |   ✓   |   ✓   |         |
| Schedule account deletion                                | `scheduleAccountDeletion`                                                     |   ✓   |   ✓   |         |
| Grant, change or remove platform roles                   | `setPlatformRole`                                                             |   ✓   |       |         |
| View a person's plan, storage, AI use and payments       | `adminBilling.userBilling`                                                    |   ✓   |   ✓   |    ✓    |
| Give or extend a Pro trial                               | `adminBilling.extendTrial`                                                    | ✓ (90 days) | ✓ (90 days) | ✓ (14 days) |
| Prepare a Personal export for the person (delivered to them only) | `adminBilling.requestUserExport`                                     |   ✓   |   ✓   |    ✓    |
| Set a plan by hand, grant AI, override storage or device limit | `adminBilling.setPlan`, `setAiGrant`, `setStorageOverride`, `setDeviceLimit` |   ✓   |   ✓   |         |
| Mark a payment refunded                                  | `adminBilling.markRefunded`                                                   |   ✓   |       |         |
| User analytics (aggregates)                              | `adminAnalytics.users`                                                        |   ✓   |   ✓   |    ✓    |
| Revenue analytics                                        | `adminAnalytics.revenue`                                                      |   ✓   |   ✓   |         |
| List and view workspaces                                 | `listWorkspaces`, `viewWorkspace`                                             |   ✓   |   ✓   |    ✓    |
| Suspend / unsuspend a workspace                          | `setWorkspaceSuspended`                                                       |   ✓   |   ✓   |         |
| Set workspace storage quota and member limit             | `setWorkspaceQuota`                                                           |   ✓   |   ✓   |         |
| Set a workspace's plan by hand (not Stripe-billed ones)   | `adminBilling.setWorkspacePlan`                                               |   ✓   |   ✓   |         |
| View the email send log                                  | `listEmails`                                                                  |   ✓   |   ✓   |    ✓    |
| Resend a failed email                                    | `resendEmail`                                                                 |   ✓   |   ✓   |    ✓    |
| View configuration                                       | `configuration`                                                               |   ✓   |   ✓   |    ✓    |
| Change flags, rate limits, templates                     | `setFlag`, `setRateLimit`, `setTemplateEnabled`                               |   ✓   |   ✓   |         |
| Maintenance banner and read-only mode                    | `setMaintenance`                                                              |   ✓   |       |         |
| Audit log: everyone's entries                            | `auditLog` (no filter)                                                        |   ✓   |       |         |
| Audit log: own entries, or all entries for one target    | `auditLog` (default / `targetType`+`targetId`)                                |   ✓   |   ✓   |    ✓    |
| Deletion jobs                                            | `deletionJobs`                                                                |   ✓   |   ✓   |         |

¹ Only an owner can suspend another owner. Nobody can suspend themselves.

**Note content stays private.** No admin path returns note bodies. "Prepare export" builds the
person's Personal as a ZIP and delivers it to *them* as a notification with a download link; staff
never receive the file or its contents.

The UI mirrors this matrix in `apps/web/src/components/admin/permissions.ts`: navigation
items a role can't use are hidden, and actions it can't take are disabled with a one-line
explanation. Keep that file in sync when `convex/admin.ts` changes.

## 3. Actions and their safeguards

Every action opens a dialog. All of them require a **reason of at least 8 characters**
(trimmed, capped at 500). The server enforces this too, and the reason is stored in the audit
entry. Validation errors are attached to their fields (`aria-invalid` and
`aria-describedby`), and server errors are shown inside the dialog, which stays open. A
success shows a toast, and detail pages reload their data by calling the audited view again.

| Action                        | Typed confirmation         | Other safeguards                                                                                                                                                                                                                                      |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suspend / unsuspend user      | User's email               | Not yourself. Owners can only be suspended by an owner. Suspending revokes every session and blocks the user at the identity provider. Data is untouched.                                                                                   |
| Revoke all sessions           | —                          | Revokes mirrored sessions and asks the identity provider to end its sessions. Offline edits stay on the user's devices.                                                                                                                              |
| Resend verification           | —                          | Offered only while the email is unverified; the server refuses otherwise. The link goes to the user, never to the admin.                                                                                                                              |
| Password reset                | —                          | Checkbox "The user asked for this…" must be ticked. The API requires `userRequested: true`. Use it only after verifying the request came from the account holder. The reset link is emailed to the user; admins never see it.                          |
| Platform role                 | User's email               | Owner only. The target needs a verified email **and** TOTP to receive a role. At least one owner must remain.                                                                                                                                        |
| Schedule account deletion     | User's email               | Refused while the user holds a platform role. Deletion runs after 7 days. The user is emailed and can cancel by signing in. Their Personal and workspaces nobody else is in are deleted; a workspace other people use passes to its longest-standing admin, else member (who is told) — other people's work is never deleted. |
| Suspend / unsuspend workspace | Workspace name (exact)     | Everyone except owners becomes read-only. Nothing is deleted. Not available for workspaces that are already being deleted.                                                                                                                           |
| Set quota                     | —                          | Storage in GB (1024³ bytes, ≥ 0; replaces the plan's limit for that workspace) and member limit 1–10,000. Lowering a quota below usage blocks new uploads or invites; nothing is removed.                                                                                                          |
| Resend failed email           | —                          | Failed attempts only. Identity emails (one-time links) can never be replayed; use "Resend verification" or a password reset instead. Notices whose payload wasn't stored can't be replayed, and the server says so.                                    |
| Feature flag                  | —                          | Only known flags (`KNOWN_FLAGS`). Takes effect for everyone immediately.                                                                                                                                                                             |
| Maintenance                   | —                          | Banner ≤ 280 characters. Read-only mode blocks writes from non-admins; clients keep edits locally and sync afterwards.                                                                                                                                |
| Rate limit                    | —                          | Known rules only. Limit 1–100,000, window 1 s–24 h. "Reset to default" removes the override.                                                                                                                                                         |
| Built-in template             | —                          | Hides or shows a starter template for new documents; existing documents are unaffected.                                                                                                                                                             |

## 4. Audit log

Records are written by `recordAudit` (`convex/lib/audit.ts`) into `adminAuditLogs`.

- **Immutable.** It is append-only: no backend code path updates or deletes an audit
  record, and the console has no edit or delete control. This is enforced in CI by
  `tests/convex/static/invariants.test.ts`, which fails if any backend module patches,
  replaces or deletes `adminAuditLogs` rows.
- **Fields recorded:** actor (profile id), actor role at the time, action (e.g.
  `user.suspend`), target type and id, reason, `before`/`after` state for changes,
  `createdAt`, a **request id**, and a **client hash**.
  - *Request id*: a ULID the console generates for each action or view. If one isn't
    supplied, the server generates it. The console shows it next to each entry so an action
    can be traced across logs.
  - *Client hash*: the console sends a truncated SHA-256 of the admin's user agent,
    language, time zone and screen size with every change and every audited read. No raw values are stored. The
    client computes it, so treat it as a correlation hint, not proof of the device.
- **What is audited:** every change listed above, plus these reads: `user.search` (the
  query is stored only as a keyed hash; "all" for an empty query), `user.view`,
  `workspace.list` (names are user content), `workspace.view` and `email.list`. Aggregate reads
  (dashboard, configuration, deletion jobs, the audit log itself) are not audited.
- **Who sees it:** super admins see the whole log. Other admins see their own entries, or
  every entry for one target when they filter by target type and id. The console shows
  before/after as a field-by-field diff.
- **No content, ever.** Audit entries hold ids, states and reasons, never document content.

## 5. Bootstrapping the first super admin

1. The person signs in to the product once so that their profile exists, with a verified
   email and TOTP.
2. Someone with deploy access to the Convex deployment runs:
   ```sh
   npx convex run admin:bootstrapSuperAdmin '{"email":"you@example.com"}'
   ```
   `bootstrapSuperAdmin` is an `internalMutation`, so it can only be called from the CLI or
   dashboard, never from a client. It refuses if any super admin already exists, and it
   writes a `bootstrap.super_admin` audit entry.
3. Grant every further role from the console (**Users → person → Platform role…**). That path
   is audited and requires typed confirmation.

## 6. Break-glass support access: not implemented

There is **no** way for an admin to impersonate a user, sign in as them, or read their
documents, files or comments. This is deliberate. A break-glass feature would need at least:

- Explicit, time-boxed consent from the account or workspace owner (or a documented legal
  basis), recorded with the grant.
- Two-person approval, with the approver a different super admin from the requester.
- A separate, short-lived, read-only credential scoped to one workspace, which expires
  automatically and can't be extended silently.
- Content access routed through dedicated audited functions that log every document opened,
  plus notification to the owner afterwards.
- Retention and review of those logs, and a written policy in the privacy notice.

Until all of that exists, support work uses metadata only: sessions, memberships, email
attempts, quotas and the audit trail.

## 7. Email operations: honesty rules

- **"Accepted" is not "delivered".** `accepted` means Loops accepted the message for
  sending. The console says so on the Emails page and the dashboard.
- Delivery, bounce and complaint states appear only when the **signed Loops webhook** is
  configured (`LOOPS_WEBHOOK_SECRET`), and only for events whose signature was verified. If
  it isn't configured, the Emails page says so plainly rather than showing empty states as
  good news.
- To check delivery for a template, use the Loops dashboard → **Transactional** → the
  template → **Metrics**.
- Recipients are shown only as redacted hints (`a***@e***.com`). Invite emails on workspace
  pages are redacted the same way.
- Identity emails (verification, password reset) carry one-time links and are never
  replayed. Use the dedicated user actions, which ask the identity provider for a fresh link
  that goes only to the user.
- See [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md) for the full runbook.

## 8. Pages

| Path                         | Shows                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                     | Stat tiles, 30-day signups and DAU charts (SVG with a data-table fallback), retention cohorts, failed emails (7 d), sync errors (7 d), rate-limited events (24 h), deployments. |
| `/admin/users`               | Exact-email search, or browse newest first with a name filter and status filter, 50 per page.                                                     |
| `/admin/analytics`           | User analytics: users, new signups, daily/weekly/monthly active, storage, signups and AI requests per day, plan mix, trials and conversion, AI use and grants (7–180 day window). Aggregates only. |
| `/admin/revenue`             | Admins and owners: MRR, ARR, paying accounts, revenue per payer, last 30 days, at-risk (canceling/past due), revenue, new and canceled by month, subscribers per plan, workspace plans (paying workspaces, billed seats, workspace MRR), recent payments (emails redacted). Test purchases are excluded unless switched on. |
| `/admin/users`               | Plan column: Free/Basic/Pro, "· trial" while on the Pro trial, and an AI badge for grants.                                                        |
| `/admin/users/[id]`          | Identity metadata, verification and TOTP badges, sessions, memberships, usage, recent emails, admin history, and the actions above. **Plan & billing**: Personal plan, provider, renewal, AI access and 30-day use in Personal, personal storage, payments, and the billing actions (set plan, trial, AI grant, storage limit, prepare export, mark refunded). Loading it is an audited read (`user.view_billing`). |
| `/admin/workspaces`          | All workspaces, paginated.                                                                                                                        |
| `/admin/workspaces/[id]`     | Members and roles, usage against quotas, redacted invites, admin history, suspend and quota. **Plan & billing**: the workspace's plan (never its owner's Personal plan), billed seats and estimated charge, payments, and Set plan. |
| `/admin/emails`              | The last 100 send attempts, with a status filter, provider events, resend for eligible failures, and the delivery explainer.                     |
| `/admin/audit`               | The paginated log with a target filter and an expandable before/after diff.                                                                       |
| `/admin/deletion-jobs`       | Deletion jobs with status and progress (live).                                                                                                    |
| `/admin/configuration`       | Feature flags, maintenance banner and read-only mode, rate limits, built-in templates.                                                            |

The daily active users figure, weekly active users figure and retention cohorts come from the
`daily metrics` cron (00:15 UTC). Until it has run once, the dashboard shows "—" and says why.

End-to-end coverage: `apps/web/e2e/admin.spec.ts` (non-admin 404, signed-out redirect,
dashboard, audited search and view, suspend requires a reason, plan/AI/export from the user page,
analytics and revenue, support-staff limits, and axe checks in light and dark). Server rules:
`tests/convex/billing.test.ts`.
