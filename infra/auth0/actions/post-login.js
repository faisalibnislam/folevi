/**
 * Folevi — Auth0 Action, trigger: post-login (Login flow).
 *
 * 1. Blocks suspended users (app_metadata.folevi_suspended === true).
 * 2. Blocks users whose email is not verified. Auth0 sends the verification email at sign-up
 *    (through the custom-email-provider Action) BEFORE this runs, so denying here never leaves
 *    a user without a link. Resend is handled by Folevi's /verify-email page, which calls the
 *    Management API `POST /api/v2/jobs/verification-email` (see infra/auth0/README.md).
 * 3. Requires OTP MFA on every interactive login unless the browser is remembered:
 *    - not yet enrolled in OTP → api.authentication.enrollWith({ type: "otp" }) (forces OTP
 *      specifically; recovery codes are issued with the enrollment when enabled in the tenant)
 *    - enrolled → api.multifactor.enable("any", { allowRememberBrowser: true })
 *    The dashboard MFA policy stays "Never"; this Action is the single source of the policy.
 * 4. Adds ID-token claims so the Convex backend can enforce both requirements itself:
 *      https://folevi.com/email_verified  (boolean)
 *      https://folevi.com/mfa             (boolean, see mfaSatisfied below)
 *
 * Messages passed to api.access.deny() are shown by Universal Login and returned to the app as
 * `error_description`; the codes before ":" let apps/web route to the right page.
 */
"use strict";

const CLAIM_NS = "https://folevi.com/";

const DENY = Object.freeze({
  suspended:
    "account_suspended: This Folevi account is suspended. Contact Folevi support if you think this is a mistake.",
  unverified:
    "email_not_verified: Please confirm your email address. We sent you a link when you signed up; you can request a new one at app.folevi.com/verify-email.",
});

function hasMfaMethod(event) {
  const methods = (event.authentication && event.authentication.methods) || [];
  return methods.some((m) => m && m.name === "mfa");
}

function hasOtp(event) {
  const factors = (event.user && event.user.enrolledFactors) || [];
  return factors.some((f) => f && f.type === "otp");
}

function isRefreshTokenExchange(event) {
  return Boolean(event.transaction && event.transaction.protocol === "oauth2-refresh-token");
}

/**
 * @param {Event} event - Details about the user and the context in which they are logging in.
 * @param {PostLoginAPI} api - Interface whose methods can be used to change the behavior of the login.
 */
exports.onExecutePostLogin = async (event, api) => {
  const user = event.user || {};
  const appMetadata = user.app_metadata || {};

  if (appMetadata.folevi_suspended === true) {
    api.access.deny(DENY.suspended);
    return;
  }

  const emailVerified = user.email_verified === true;
  if (!emailVerified) {
    api.access.deny(DENY.unverified);
    return;
  }

  const refresh = isRefreshTokenExchange(event);
  const alreadyMfa = hasMfaMethod(event);
  let mfaSatisfied = alreadyMfa;

  if (refresh) {
    // MFA cannot be prompted during a refresh-token exchange. The refresh token was only ever
    // issued by an interactive login gated by this Action, so an OTP-enrolled user is treated as
    // satisfied. (Unverified assumption about event.authentication on refresh: see README.)
    mfaSatisfied = alreadyMfa || hasOtp(event);
  } else if (!alreadyMfa) {
    if (!hasOtp(event)) {
      // Force OTP enrollment specifically (not SMS/email/push).
      api.authentication.enrollWith({ type: "otp" });
    } else {
      // Challenge enrolled users; remembered browsers (30 days, tenant setting) skip the prompt.
      api.multifactor.enable("any", { allowRememberBrowser: true });
    }
    // Tokens are only issued after the required MFA step completes (or the remembered-browser
    // cookie satisfies it), so the claim describes the policy that gated this token.
    mfaSatisfied = true;
  }

  api.idToken.setCustomClaim(`${CLAIM_NS}email_verified`, emailVerified);
  api.idToken.setCustomClaim(`${CLAIM_NS}mfa`, mfaSatisfied);
};

exports._internals = { DENY, CLAIM_NS };
