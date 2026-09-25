# Auth0 tenant checklist

Use this list once per tenant (prod, staging, dev). Tick each item when it is done or when an
audit confirms it. [README.md](./README.md) explains why each setting is what it is.

Tenant: `__________` Environment: prod / staging / dev Date: `__________` By: `__________`

## Plan verification (do this first)

- [ ] The Custom Email Provider (Action) is available on this plan. If it is not, stop and follow
      the fallback path in `docs/EMAIL_DECISION.md`.
- [ ] Email template customization is available.
- [ ] Sessions API and refresh-token endpoints are available. If they are not, remove those scopes
      from the M2M grant and note it here: `______`.
- [ ] Breached Password Detection and Suspicious IP Throttling are available.
- [ ] Custom domain is available.

## Applications

- [ ] **Folevi Web** (Regular Web App). The callback, logout and web origin URLs are exactly as in
      the README (prod `https://app.folevi.com/auth/callback`, dev
      `http://app.localhost:3000/auth/callback`).
- [ ] Folevi Web: grant types are Authorization Code and Refresh Token only. Refresh token
      rotation is on.
- [ ] **Folevi for Mac** (Native). Both callbacks are present:
      `com.folevi.mac://auth.folevi.com/macos/com.folevi.mac/callback` and
      `https://auth.folevi.com/macos/com.folevi.mac/callback`.
- [ ] Folevi for Mac: auth method None (PKCE). Rotation is on, with reuse interval 0. Absolute
      lifetime is 30 days and inactivity is 14 days.
- [ ] Folevi for Mac: Team ID and bundle id are set for universal links.
- [ ] **Folevi Backend** (M2M) is authorized for the Management API with exactly these scopes:
      `read:users update:users update:users_app_metadata delete:users create:user_tickets read:authentication_methods`,
      plus `read:sessions delete:sessions read:refresh_tokens delete:refresh_tokens` where the plan
      allows them.
- [ ] No other applications exist. Delete the "Default App" and any test apps.

## Connections

- [ ] There is exactly one database connection, `Username-Password-Authentication`, and only
      Folevi Web and Folevi for Mac are enabled on it.
- [ ] Disable Sign Ups is **OFF**.
- [ ] Password policy is Good or stricter. Minimum length is 10. Dictionary, Disallow Personal
      Data and History (5) are on.
- [ ] All social, enterprise and passwordless connections are disabled, including
      `google-oauth2`.

## Attack Protection

- [ ] Breached Password Detection is on for sign-up and login, and blocks and notifies.
- [ ] Brute-force Protection is on, with threshold 10, and notifies.
- [ ] Suspicious IP Throttling is on.

## MFA

- [ ] One-time Password is on. Recovery Code is on. All other factors are off.
- [ ] The dashboard policy is **Never**. The post-login Action enforces MFA.
- [ ] "Customize MFA Factors using Actions" is on.
- [ ] The app copy "Trust this browser for 30 days" matches the 30-day remember-browser period.

## Actions

- [ ] `post-login.js` is deployed and **attached to the Login flow**. No other post-login Actions
      are attached, unless they are reviewed.
- [ ] `custom-email-provider.js` is deployed with every secret set: `LOOPS_API_KEY`,
      `AUTH0_LINK_HOSTS`, the five `LOOPS_TRANSACTIONAL_AUTH_*_ID`,
      `FOLEVI_EMAIL_ALLOWLIST_MODE` (`off` only in prod), the TTL secrets, and
      `FOLEVI_PASSWORD_RESET_URL`.
- [ ] Branding > Email Provider is set to Custom Provider, using the Action.
- [ ] "Send test email" produces a `config_ok` entry in the Action logs.

## Email templates

- [ ] Verification Email (link) is enabled. Its URL lifetime (86 400 s) equals
      `AUTH0_VERIFY_EMAIL_TTL_HOURS` × 3600. It redirects to
      `https://app.folevi.com/verify-email/done`.
- [ ] Change Password is enabled. Its URL lifetime (3 600 s) equals
      `AUTH0_RESET_PASSWORD_TTL_HOURS` × 3600.
- [ ] Blocked Account and Password Breach Alert are enabled.
- [ ] Welcome Email is disabled.
- [ ] Every enabled template body is reduced to `<a href="{{ url }}">{{ url }}</a>`, or
      `{{ code }}` for code templates.

## Domain and branding

- [ ] The custom domain `auth.folevi.com` is verified and is the default for emails.
- [ ] Universal Login colors are set: primary `#3159D8`, page `#F4F1E9`, widget `#FBFAF6`, text
      `#18201C` / `#5F6962`, border `#D8D7CF`. The logo is uploaded.

## Smoke test (use an @example.com seed inbox, or an allowlisted address in non-prod)

- [ ] Sign up. The Loops verify email arrives, and the Action logs `accepted` with the address
      redacted.
- [ ] Log in before verifying. You see the "email_not_verified" message.
- [ ] Resend from `/verify-email` works, and gives the same response for unknown addresses.
- [ ] After verifying, you are forced to enroll OTP, and recovery codes are shown.
- [ ] Log out and log in with "trust this browser" set. You get no prompt. In a new private
      window, you are prompted.
- [ ] Forgot password: the Loops reset email arrives, and the link works once.
- [ ] Fail the password 10 times. The blocked-account email arrives, and the unblock link path
      matches the Action's allow-list. If it does not, update `LINK_PATHS` and record the real
      path here: `______`.
- [ ] The ID token contains `https://folevi.com/email_verified: true` and
      `https://folevi.com/mfa: true`.
- [ ] Refresh-token exchange (Mac app): the claims are still present and no MFA error appears.
- [ ] Set `app_metadata.folevi_suspended = true`. Login is denied, and so is the next refresh.
