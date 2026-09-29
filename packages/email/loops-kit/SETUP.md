# Folevi — Loops transactional templates

Sending domain: `mail.folevi.com` (verify it in Loops → Settings → Domain first). Reply-To on every template: `support@folevi.com`.

For each template, in Loops: **Transactional → New** → editor → **Code** → upload the zip → set Subject,
Preview, From and Reply-To → add each data variable (tick *optional* only where marked) → **Publish** →
copy its **Transactional ID** and save it to Convex production:

```
npx convex env set <ENV VAR>        # prompts for the value
```

Do the first two before anyone signs up: without them, confirmation and password-reset emails can't send.

## 01. auth_verify_email  — needed before launch

- **Upload:** `01-auth_verify_email.zip`
- **Subject:** Confirm your email for Folevi
- **Preview:** Confirm this address to finish setting up your Folevi account.
- **From:** Folevi <security@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `actionUrl` (string) — Email-verification link from Folevi's own sign-in (Better Auth on Convex, served under the app host).
  - `expiresInHours` (number) — Hours until the link expires (matches the verification token lifetime).
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_AUTH_VERIFY_EMAIL_ID`

## 02. auth_password_reset  — needed before launch

- **Upload:** `02-auth_password_reset.zip`
- **Subject:** Reset your Folevi password
- **Preview:** Use this link to choose a new password. If you did not ask, ignore this email.
- **From:** Folevi <security@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `actionUrl` (string) — Password-reset link from Folevi's own sign-in (single use).
  - `expiresInHours` (number) — Hours until the link expires.
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_AUTH_PASSWORD_RESET_ID`

## 03. security_new_device

- **Upload:** `03-security_new_device.zip`
- **Subject:** New sign-in to your Folevi account
- **Preview:** A new device signed in to your account. Review it if this was not you.
- **From:** Folevi <security@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `deviceLabel` (string) — Human label, e.g. "Safari on macOS".
  - `approximateLocation` (string, **optional**) — Coarse location (city/region). Optional: pass "Not available" rather than omitting when unknown.
  - `signedInAt` (string) — Pre-formatted sign-in time including timezone.
  - `securityUrl` (string) — Link to Settings > Security (sessions & devices).
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_SECURITY_NEW_DEVICE_ID`

## 04. account_deletion_scheduled

- **Upload:** `04-account_deletion_scheduled.zip`
- **Subject:** Your Folevi account is scheduled for deletion
- **Preview:** Your account and notes will be deleted. You can still cancel.
- **From:** Folevi <security@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `scheduledFor` (string) — Pre-formatted deletion date.
  - `cancelUrl` (string) — Link to cancel the scheduled deletion (requires sign-in).
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_ACCOUNT_DELETION_SCHEDULED_ID`

## 05. account_deletion_completed

- **Upload:** `05-account_deletion_completed.zip`
- **Subject:** Your Folevi account has been deleted
- **Preview:** Your account and its data have been deleted.
- **From:** Folevi <security@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `completedOn` (string) — Pre-formatted date the deletion completed.
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_ACCOUNT_DELETION_COMPLETED_ID`

## 06. workspace_invite

- **Upload:** `06-workspace_invite.zip`
- **Subject:** You have been invited to a Folevi workspace
- **Preview:** Accept the invitation to start working together in Folevi.
- **From:** Folevi <hello@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `inviterName` (string) — Display name of the inviter (user-controlled).
  - `workspaceName` (string) — Workspace name (user-controlled).
  - `role` (string) — Role granted, e.g. "Member".
  - `acceptUrl` (string) — Invitation acceptance link.
  - `expiresInDays` (number) — Days until the invitation expires.
  - `preferencesUrl` (string) — Email preferences page.
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_WORKSPACE_INVITE_ID`

## 07. mention_notification

- **Upload:** `07-mention_notification.zip`
- **Subject:** You were mentioned in Folevi
- **Preview:** Someone mentioned you in a document.
- **From:** Folevi <hello@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `actorName` (string) — Display name of the person who mentioned you.
  - `documentTitle` (string) — Document title (user-controlled).
  - `documentUrl` (string) — Deep link to the mention.
  - `preferencesUrl` (string) — Email preferences page.
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_MENTION_NOTIFICATION_ID`

## 08. comment_notification

- **Upload:** `08-comment_notification.zip`
- **Subject:** New comment in Folevi
- **Preview:** Someone commented on a document you follow.
- **From:** Folevi <hello@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `actorName` (string) — Display name of the commenter.
  - `documentTitle` (string) — Document title (user-controlled).
  - `documentUrl` (string) — Deep link to the comment thread.
  - `preferencesUrl` (string) — Email preferences page.
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_COMMENT_NOTIFICATION_ID`

## 09. comment_digest

- **Upload:** `09-comment_digest.zip`
- **Subject:** Your Folevi comment digest
- **Preview:** A summary of recent comments on your documents.
- **From:** Folevi <hello@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `count` (number) — Number of new comments summarised.
  - `summary` (string) — Plain-text summary (titles and names only, no comment bodies).
  - `inboxUrl` (string) — Link to the in-app inbox.
  - `preferencesUrl` (string) — Email preferences page.
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_COMMENT_DIGEST_ID`

## 10. share_notification

- **Upload:** `10-share_notification.zip`
- **Subject:** A document was shared with you in Folevi
- **Preview:** You now have access to a document in Folevi.
- **From:** Folevi <hello@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `actorName` (string) — Display name of the person who shared.
  - `documentTitle` (string) — Document title (user-controlled).
  - `role` (string) — Access level, e.g. "Can comment".
  - `documentUrl` (string) — Link to the document.
  - `preferencesUrl` (string) — Email preferences page.
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_SHARE_NOTIFICATION_ID`

## 11. access_changed

- **Upload:** `11-access_changed.zip`
- **Subject:** Your access in Folevi changed
- **Preview:** Someone changed what you can open or edit in Folevi.
- **From:** Folevi <hello@mail.folevi.com>
- **Reply-To:** support@folevi.com
- **Data variables:**
  - `actorName` (string) — Display name of the person who made the change.
  - `summary` (string) — Server-composed sentence from fixed phrases, e.g. 'changed your access to "Plan" to Can comment.' Contains a title (user-controlled), never content.
  - `actionUrl` (string) — Link to the document when still accessible, otherwise to the document list.
  - `preferencesUrl` (string) — Email preferences page.
- **Save the Transactional ID to:** `LOOPS_TRANSACTIONAL_ACCESS_CHANGED_ID`

