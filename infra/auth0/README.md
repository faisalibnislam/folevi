# Auth0 tenant for Folevi

This directory holds the Auth0 configuration Folevi depends on: two Actions (pasted into the
Auth0 dashboard) and the exact tenant setup. Use [`tenant-checklist.md`](./tenant-checklist.md)
when you build or audit a tenant.

| File                               | What it is                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `actions/custom-email-provider.js` | Trigger **custom-email-provider**. Sends Auth0 identity emails through Loops. See `docs/EMAIL_DECISION.md`. |
| `actions/post-login.js`            | Trigger **post-login**. Blocks suspended and unverified users, requires OTP MFA, and adds ID-token claims.  |
| `package.json`                     | Marks this folder as CommonJS, which is what Auth0 Actions use. It is not a workspace package.              |

The Actions are unit-tested from `packages/email/test/auth0-actions.test.ts`
(`pnpm --filter @folevi/email test`). That test also checks that the Action's message-type mapping
matches `AUTH0_MESSAGE_TYPE_TO_TEMPLATE` in `@folevi/email`.

## Tenants

| Tenant           | Purpose                                     | `FOLEVI_EMAIL_ALLOWLIST_MODE` |
| ---------------- | ------------------------------------------- | ----------------------------- |
| `folevi` (prod)  | production, custom domain `auth.folevi.com` | `off`                         |
| `folevi-staging` | previews and staging                        | `test-domains`                |
| `folevi-dev`     | local development                           | `test-domains`                |

Every non-production tenant must set `test-domains`. If the secret is missing, the Action behaves
as if it were `test-domains` (fail closed). Only `@example.com`, `@test.com` and the addresses in
`FOLEVI_EMAIL_ALLOWLIST` get email.

## Applications

### 1. Folevi Web (Regular Web Application, Next.js / `@auth0/nextjs-auth0`)

| Setting                    | Production                                       | Development                               |
| -------------------------- | ------------------------------------------------ | ----------------------------------------- |
| Allowed Callback URLs      | `https://app.folevi.com/auth/callback`           | `http://app.localhost:3000/auth/callback` |
| Allowed Logout URLs        | `https://app.folevi.com/`, `https://folevi.com/` | `http://app.localhost:3000/`              |
| Allowed Web Origins        | `https://app.folevi.com`                         | `http://app.localhost:3000`               |
| Application Login URI      | `https://app.folevi.com/auth/login`              | (leave empty; Auth0 rejects http here)    |
| Token Endpoint Auth Method | Client Secret (Post)                             | same                                      |
| Grant types                | Authorization Code, Refresh Token                | same                                      |
| ID token expiration        | 36000 s (default)                                | same                                      |
| Refresh Token Rotation     | on                                               | on                                        |

Preview deployments sign in against the staging tenant. Add their callback URLs one at a time or
through a stable preview alias. Never use a wildcard across `*.vercel.app`.

### 2. Folevi for Mac (Native)

| Setting                    | Value                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Allowed Callback URLs      | `com.folevi.mac://auth.folevi.com/macos/com.folevi.mac/callback`, `https://auth.folevi.com/macos/com.folevi.mac/callback`      |
| Allowed Logout URLs        | the same two URLs                                                                                                              |
| Grant types                | Authorization Code (PKCE, no secret), Refresh Token                                                                            |
| Refresh Token Rotation     | **on**, reuse interval 0 s                                                                                                     |
| Refresh Token Expiration   | **Absolute** on, 2 592 000 s (30 days). Inactivity 1 209 600 s (14 days).                                                      |
| Device settings (Advanced) | Team ID and App bundle ID `com.folevi.mac`, for universal-link callbacks (Associated Domains `webcredentials:auth.folevi.com`) |

The custom-scheme callback is the fallback. The https (universal-link) callback is preferred
because no other app can claim it. `{domain}` is the custom domain `auth.folevi.com`. Staging and
dev use their own tenant domains.

### 3. Folevi Backend (Machine to Machine) → Auth0 Management API

Only the Folevi backend (Convex actions) uses this app. It needs these scopes and nothing else:

| Scope                                          | Why                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read:users`                                   | Look up a user by id or email. The `/verify-email` resend flow uses `GET /api/v2/users-by-email`.                                                            |
| `update:users`                                 | Required by `POST /api/v2/jobs/verification-email` (resend verification). Also used to change the email address after re-verification.                       |
| `update:users_app_metadata`                    | Set `app_metadata.folevi_suspended`, which the post-login Action enforces.                                                                                   |
| `delete:users`                                 | Final step of account deletion, after the grace period in `account_deletion_scheduled`.                                                                      |
| `create:user_tickets`                          | Email-verification and password-change tickets. Only the fallback email path uses this (`docs/EMAIL_DECISION.md`). Keep it so the switch needs no new grant. |
| `read:authentication_methods`                  | Show the user's enrolled MFA factors on Settings > Security.                                                                                                 |
| `read:sessions`, `delete:sessions`             | List and revoke sessions ("sign out everywhere"). **Plan-dependent (unverified).** Omit them if the plan does not offer the Sessions API.                    |
| `read:refresh_tokens`, `delete:refresh_tokens` | Revoke the Mac app's refresh tokens on sign-out everywhere or suspension. **Plan-dependent (unverified).**                                                   |

We deliberately leave these out: `create:users` (accounts are only created through Universal Login
sign-up), `delete:authentication_methods` (MFA resets are a support procedure run in the dashboard
with identity checks), `read:user_idp_tokens`, and every `*:clients`, `*:connections` and
`*:actions` scope. The backend never changes tenant configuration.

## Connections

- **Database:** a single `Username-Password-Authentication` connection. Only **Folevi Web** and
  **Folevi for Mac** are enabled on it.
  - **Disable Sign Ups: OFF.** People sign up through Universal Login. There is no other sign-up
    path: the backend M2M app has no `create:users`, and the public `/dbconnections/signup`
    endpoint is only reachable with the enabled client ids.
  - Password policy: **Good** or stricter, minimum length **10**, **Password Dictionary** on,
    **Disallow Personal Data** on, **Password History** 5.
  - Requires Username: off. Email is the identifier.
- **Social, enterprise and passwordless connections:** all **disabled**, including the default
  `google-oauth2` on new tenants. This is also why the Action drops `verification_code`
  (passwordless) messages.

## Attack Protection

- **Breached Password Detection:** on, for sign-up and login. Response: block and notify the user.
  The notice goes out as `stolen_credentials`, which maps to `auth_breached_password`.
- **Brute-force Protection:** on. Threshold 10. Notify the user (`blocked_account`, which maps to
  `auth_blocked_account`).
- **Suspicious IP Throttling:** on, with default limits.
- Bot Detection: turn it on if the plan includes it.

## Multi-factor authentication

- Factors: **One-time Password: on**. **Recovery Code: on**. Every other factor is off, including
  SMS, voice, email, push, and WebAuthn for now.
- **Policy: "Never" in the dashboard. The post-login Action enforces MFA.** Why:
  - The Action is the one place the rule lives. It forces _OTP_ enrollment specifically with
    `api.authentication.enrollWith({ type: "otp" })`. It challenges enrolled users with
    `api.multifactor.enable("any", { allowRememberBrowser: true })`. It skips MFA during
    refresh-token exchanges, where Auth0 cannot prompt.
  - With the dashboard set to "Always", Auth0 adds its own challenge on top of the Action. That
    duplicates prompts and hides which rule is in force.
  - Risk: if someone detaches the Action, MFA silently stops. The backend mitigates this by
    refusing ID tokens that lack `https://folevi.com/mfa: true`, so the failure is closed.
- **Remember browser: 30 days.** This is the trusted-device expiry. Auth0 documents
  `allowRememberBrowser` as a 30-day prompt interval, and the app's copy ("Trust this browser for
  30 days") must match that number exactly. The docs state this interval explicitly only for the
  `google-authenticator`/`duo` providers. Confirm it for `"any"` during the tenant smoke test.
- Customize MFA Factors using Actions: **on** (Security > Multi-factor Auth). `enrollWith` needs
  it.

## Post-login Action (`actions/post-login.js`)

The Action runs in this order:

1. If `app_metadata.folevi_suspended === true`, it calls `api.access.deny("account_suspended: …")`.
2. If `!event.user.email_verified`, it calls `api.access.deny("email_not_verified: …")`. Universal
   Login shows the message. The app gets `error=access_denied` with that `error_description` and
   routes to `/verify-email`.
3. MFA:
   - Refresh-token exchange: no prompt.
   - No OTP enrolled: `enrollWith({type:"otp"})`.
   - Otherwise: `multifactor.enable("any", {allowRememberBrowser:true})`.
   - MFA already in `event.authentication.methods`: no prompt.
4. Claims on the ID token, which the Convex backend enforces:
   - `https://folevi.com/email_verified` (boolean)
   - `https://folevi.com/mfa` (boolean). It is true when this login already contains an `mfa`
     method, or when the Action required MFA for this transaction (tokens are only issued once
     that step passes). On a refresh-token exchange it is true when the user has OTP enrolled.
     That relies on refresh tokens only ever being minted by an MFA-gated login, which is an
     **assumption to verify** on the real tenant (inspect `event.authentication` on refresh).

### Why denying unverified users is safe, and how "resend" works

Auth0 sends the verification email as part of sign-up, through the custom email provider, before
the first post-login run. Denying afterwards never leaves a new user without a link. For a
**resend**:

1. `apps/web` `/verify-email` asks for the email address. The user has no session at this point.
2. The backend rate-limits the request per IP and per `hashRecipient(email)`. It then calls
   `GET /api/v2/users-by-email?email=…` (`read:users`).
3. For a matching `auth0|…` user with `email_verified: false`, it calls
   `POST /api/v2/jobs/verification-email` with `{ user_id, client_id: <Folevi Web> }`
   (`update:users`).
4. Auth0 sends it through the custom-email-provider Action. The Action maps `verify_email` to
   Loops `auth_verify_email`.
5. The page always answers "If an account exists for that address, we have sent a new link", so
   it cannot be used to find out which addresses have accounts.

## Custom email provider (`actions/custom-email-provider.js`)

- Create the Action with trigger **Custom Email Provider**, set its secrets (the full list is in
  the file header and in `docs/EMAIL_OPERATIONS.md`), deploy it, then go to **Branding > Email
  Provider > Use my own email provider > Custom Provider** and select the Action.
- Default From address in the provider settings: `security@<LOOPS_SENDING_DOMAIN>`. Loops ignores
  it (each Loops template has its own sender), but Auth0 requires a value.
- **Email templates** (Branding > Email Templates). They must be _enabled_, or Auth0 never
  triggers the provider:
  - Verification Email (link): enabled. URL lifetime **86 400 s**, which must equal
    `AUTH0_VERIFY_EMAIL_TTL_HOURS=24`. Redirect To: `https://app.folevi.com/verify-email/done`.
  - Change Password: enabled. URL lifetime **3 600 s**, which must equal
    `AUTH0_RESET_PASSWORD_TTL_HOURS=1`. Redirect To: `https://app.folevi.com/auth/login`.
  - Blocked Account: enabled. Password Breach Alert: enabled.
  - Welcome Email: **disabled** (the Action drops it anyway).
  - Replace each enabled template's body with a minimal body that contains only
    `<a href="{{ url }}">{{ url }}</a>` (or `{{ code }}` for code templates). This makes link
    extraction deterministic. Auth0's copy is never shown to users, because Loops holds the real
    copy.
- **"Send test email"** in the dashboard produces `try_provider_configuration_email`. The Action
  treats it as a configuration check: it logs `config_ok` or `config_incomplete` with the missing
  secret names, and sends nothing.
- Link acceptance rules: the link must be https, on a host in `AUTH0_LINK_HOSTS`, with no port or
  userinfo, and its path must be known for the message type:
  - `verify_email`: `/u/email-verification`, `/lo/verify_email`
  - reset and breached: `/u/reset-verify`, `/lo/reset`
  - blocked: `/u/unblock`, `/lo/unblock`, `/unblock` (**unverified**)

  The link must carry a query string, and there must be exactly one distinct match. Anything else
  is dropped with `link_not_found`.

## Custom domain and branding

- Custom domain **`auth.folevi.com`** (Auth0-managed certificate). Set it as the default domain
  for emails and for both apps' SDK configuration. `AUTH0_LINK_HOSTS` lists both
  `auth.folevi.com` and the canonical `<tenant>.us.auth0.com`, because some links may still use
  the canonical host.
- Universal Login (New), branding:
  - Primary color `#3159D8`.
  - Page background `#F4F1E9`.
  - Widget background `#FBFAF6`.
  - Body text `#18201C`, secondary text `#5F6962`.
  - Borders `#D8D7CF`.
  - Logo: the Folevi wordmark (SVG to PNG, 150 px tall max, hosted on `folevi.com`).
  - Font: system default.
  - Text customization: product name "Folevi". The MFA "remember this browser" label reads
    "Trust this browser for 30 days".

## Plan-dependent unknowns (not verified, Sept 2026)

Before relying on any of these in production, confirm them on the tenant's actual plan:

- Whether the **Custom Email Provider** (Actions-based) is available on the Free plan. If it is
  not, Auth0 would fall back to its own test sender, which we refuse to do. In that case use the
  fallback path in `docs/EMAIL_DECISION.md`.
- Whether **Email Template customization** (needed for the minimal `{{ url }}` bodies) is
  available on the plan.
- Whether the **Sessions API** and **refresh-token Management endpoints** (`read:sessions`,
  `delete:sessions`, `*:refresh_tokens`) are available.
- Whether **Breached Password Detection** and **Suspicious IP Throttling** are included, or need
  the Attack Protection add-on.
- Whether a **custom domain** on the plan requires a credit card or a paid tier.
- The exact **blocked-account unblock link path**, and whether the breached-password notice
  contains a link at all. If it has no link, the Action uses `FOLEVI_PASSWORD_RESET_URL`
  (first-party). Otherwise it drops the message.
