---
name: auth-built-in-better-auth
description: "Folevi auth decision — built-in email+password + OPTIONAL authenticator-app 2FA (admins must have it) via Better Auth on Convex, replacing Auth0"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-09-25T15:39:37.544Z
---

On 2026-09-25 the user chose to replace Auth0 (hosted Universal Login) with auth built into Folevi: email + password only, verified email, required authenticator-app TOTP with QR + manual secret + backup codes, trusted devices, session list/revoke, password reset — implemented with Better Auth (`better-auth` 1.6.x, pinned to what `@convex-dev/better-auth` supports) running as a Convex component, identity email sent via Loops (non-production captured locally instead of sent).

**Why:** Auth0 required an account/tenant the user doesn't have; they want sign-in fully working in-product in the Warm Folio design.

**Update 2026-09-29:** The user said 2FA is "not a requirement at all … totally optional", set up in Settings if they want. Now optional for accounts (on/off in Settings → Security), still required for the admin console (`requirePlatformRole` → `mfa_required`). Mac app has the PKCE sign-in now (done 2026-09-28). Don't reintroduce mandatory 2FA or copy saying it's required.

**How to apply:** Never hand-roll password/TOTP/session crypto — use Better Auth's primitives. The Mac app still has Auth0 code; per [[web-only-until-told]] leave it until the Mac phase, when it should move to browser-based Authorization Code + PKCE against Folevi (never an in-app password form / ROPG). Record the rationale in docs/AUTH_DECISION.md.
