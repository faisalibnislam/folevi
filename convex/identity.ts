// Server-to-server calls to the identity provider's Management API (Auth0). Every function degrades to
// an explicit "not_configured" result when credentials are absent — nothing is silently skipped.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

type Outcome = { ok: boolean; code: string };

function config() {
  const domain = process.env.AUTH0_MGMT_DOMAIN;
  const clientId = process.env.AUTH0_MGMT_CLIENT_ID;
  const clientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) return null;
  return { domain, clientId, clientSecret };
}

async function managementToken(cfg: NonNullable<ReturnType<typeof config>>): Promise<string | null> {
  const res = await fetch(`https://${cfg.domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      audience: `https://${cfg.domain}/api/v2/`,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

async function call(path: string, init: RequestInit): Promise<Outcome> {
  const cfg = config();
  if (!cfg) return { ok: false, code: "not_configured" };
  const token = await managementToken(cfg);
  if (!token) return { ok: false, code: "token_failed" };
  const res = await fetch(`https://${cfg.domain}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  return { ok: res.ok, code: res.ok ? "ok" : `http_${res.status}` };
}


export const revokeProviderSessions = internalAction({
  args: { profileId: v.id("profiles"), scope: v.union(v.literal("one"), v.literal("all")) },
  handler: async (ctx, args): Promise<Outcome[]> => {
    const p = await ctx.runQuery(internal.users.getForEmail, { profileId: args.profileId });
    if (!p) return [{ ok: false, code: "not_found" }];
    if (args.scope === "one") {
      // Individual provider sessions cannot be addressed from the mirror; the Folevi-side revocation
      // (sessionsMirror.revokedAt) already blocks the session's tokens at the backend.
      return [{ ok: true, code: "mirror_only" }];
    }
    const id = encodeURIComponent(p.authSubject);
    const results = [
      await call(`/api/v2/users/${id}/sessions`, { method: "DELETE" }),
      await call(`/api/v2/users/${id}/refresh-tokens`, { method: "DELETE" }),
      await call(`/api/v2/users/${id}/multifactor/actions/invalidate-remember-browser`, { method: "POST" }),
    ];
    console.log(JSON.stringify({ event: "identity.revoke_all", results: results.map((r) => r.code) }));
    return results;
  },
});

export const resendVerificationEmail = internalAction({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args): Promise<Outcome> => {
    const p = await ctx.runQuery(internal.users.getForEmail, { profileId: args.profileId });
    if (!p) return { ok: false, code: "not_found" };
    const clientId = process.env.AUTH0_WEB_CLIENT_ID;
    return await call(`/api/v2/jobs/verification-email`, {
      method: "POST",
      body: JSON.stringify({ user_id: p.authSubject, ...(clientId ? { client_id: clientId } : {}) }),
    });
  },
});

/** Starts Auth0's own password-reset flow; the email goes out through the custom provider → Loops. */
export const startPasswordReset = internalAction({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args): Promise<Outcome> => {
    const p = await ctx.runQuery(internal.users.getForEmail, { profileId: args.profileId });
    const domain = process.env.AUTH0_DOMAIN;
    const clientId = process.env.AUTH0_WEB_CLIENT_ID;
    if (!p) return { ok: false, code: "not_found" };
    if (!domain || !clientId) return { ok: false, code: "not_configured" };
    const res = await fetch(`https://${domain}/dbconnections/change_password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, email: p.email, connection: process.env.AUTH0_DB_CONNECTION ?? "Username-Password-Authentication" }),
    });
    return { ok: res.ok, code: res.ok ? "ok" : `http_${res.status}` };
  },
});

export const setProviderBlocked = internalAction({
  args: { profileId: v.id("profiles"), blocked: v.boolean() },
  handler: async (ctx, args): Promise<Outcome> => {
    const p = await ctx.runQuery(internal.users.getForEmail, { profileId: args.profileId });
    if (!p) return { ok: false, code: "not_found" };
    return await call(`/api/v2/users/${encodeURIComponent(p.authSubject)}`, {
      method: "PATCH",
      body: JSON.stringify({ blocked: args.blocked, app_metadata: { folevi_suspended: args.blocked } }),
    });
  },
});

export const deleteProviderUser = internalAction({
  args: { authSubject: v.string() },
  handler: async (_ctx, args): Promise<Outcome> => {
    return await call(`/api/v2/users/${encodeURIComponent(args.authSubject)}`, { method: "DELETE" });
  },
});
