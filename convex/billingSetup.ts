// Admin → Billing setup: the owner (super_admin) sees whether Polar is connected and whether each of the
// 14 products Folevi sells exists in Polar as the catalog (convex/lib/plans.ts) says, and can have them
// created. The same rules as the rest of the console: the role is checked on the server, every action needs
// a reason and is audited. The Polar token is the server's own (POLAR_ACCESS_TOKEN) and is never shown,
// stored or logged. Products in Polar are never edited or archived from here: a product that differs is
// reported, to be fixed in Polar (or used anyway, which is recorded). docs/BILLING.md.
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { requireIdentity, requirePlatformRole, type PlatformRole } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { fail } from "./lib/errors";
import { EXPECTED_PRODUCTS, expectedProduct, matchProducts, productCreateBody, productIds as loadProductIds, recordedProductIds, type ProductFinding } from "./lib/billingProducts";
import { PRODUCT_KEYS, envProductId, polarSend, polarServer, polarToken, productEnvName, type PolarResponse, type ProductIds, type ProductKey } from "./lib/polar";

const OWNER: PlatformRole[] = ["super_admin"];
const vMeta = { requestId: v.optional(v.string()), clientHash: v.optional(v.string()) };
const vRequest = { reason: v.string(), ...vMeta };
const LOCK_KEY = "billing_setup_lock";
const LOCK_MS = 5 * 60_000;
const checkKey = (server: "sandbox" | "production") => `billing_setup_check_${server}`;

/** The message for a token Polar refuses (401) or that lacks a scope (403). */
export const SCOPE_MESSAGE = "The Polar access token needs the products:read and products:write scopes.";

function requireReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 8) fail("invalid_argument", "Give a reason of at least a few words. It is kept in the audit log.");
  return r.slice(0, 500);
}

const isProductKey = (k: string): k is ProductKey => (PRODUCT_KEYS as string[]).includes(k);

/** What the last "Check Polar" or "Create missing products" found, per Polar server (systemSettings). */
interface CheckState {
  at: number;
  by: string;
  organizationSlug: string | null;
  findings: ProductFinding[];
  /** Keys whose recorded id wasn't among the organization's products (archived or deleted); the record was removed. */
  removed: ProductKey[];
  error: string | null;
  errorAt: number | null;
}

async function settingRow(ctx: QueryCtx | MutationCtx, key: string) {
  return await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

async function lastCheck(ctx: QueryCtx | MutationCtx, server: "sandbox" | "production"): Promise<CheckState | null> {
  return ((await settingRow(ctx, checkKey(server)))?.value as CheckState | undefined) ?? null;
}

async function putSetting(ctx: MutationCtx, key: string, value: unknown, by: Doc<"profiles">["_id"]) {
  const row = await settingRow(ctx, key);
  if (row) await ctx.db.patch(row._id, { value, updatedBy: by, updatedAt: Date.now() });
  else await ctx.db.insert("systemSettings", { key, value, updatedBy: by, updatedAt: Date.now() });
}

async function productRows(ctx: QueryCtx | MutationCtx, server: "sandbox" | "production") {
  return await ctx.db
    .query("billingProducts")
    .withIndex("by_server_key", (q) => q.eq("server", server))
    .collect();
}

const dashboardBase = (server: "sandbox" | "production") => (server === "production" ? "https://polar.sh" : "https://sandbox.polar.sh");
const dashboardUrl = (server: "sandbox" | "production", slug: string | null, id: string | null) => (slug && id ? `${dashboardBase(server)}/dashboard/${encodeURIComponent(slug)}/products/${encodeURIComponent(id)}` : null);

// ---------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------

/** Every product's Polar ids (database first, env var as a fallback), for checkout actions. */
export const productIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<ProductIds> => await loadProductIds(ctx),
});

/**
 * The Billing setup page: the Polar connection (whether settings are present, never their values) and
 * each product's status. Reads only the database and the environment; it never calls Polar.
 */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, OWNER);
    const server = polarServer();
    const rows = new Map((await productRows(ctx, server)).map((r) => [r.key, r]));
    const check = await lastCheck(ctx, server);
    const findings = new Map((check?.findings ?? []).map((f) => [f.key, f]));
    const slug = check?.organizationSlug ?? null;
    const products = EXPECTED_PRODUCTS.map((e) => {
      const row = rows.get(e.key);
      const env = envProductId(e.key) ?? null;
      const finding = findings.get(e.key);
      const inUse = row?.polarProductId ?? env;
      let status: "not_created" | "created" | "mismatch";
      let polarProductId: string | null;
      let differences: string[] = [];
      if (inUse) {
        polarProductId = inUse;
        const differs = finding && finding.polarProductId === inUse && finding.differences.length > 0 && row?.source !== "pinned";
        status = differs ? "mismatch" : "created";
        differences = row?.source === "pinned" ? (row.differences ?? []) : differs ? finding.differences : [];
      } else if (finding && finding.differences.length) {
        status = "mismatch";
        polarProductId = finding.polarProductId;
        differences = finding.differences;
      } else {
        status = "not_created";
        polarProductId = null;
      }
      return {
        key: e.key,
        envName: productEnvName(e.key),
        name: e.name,
        type: e.type,
        priceCents: e.priceCents,
        currency: e.currency,
        interval: e.interval,
        seatBased: e.seatBased,
        status,
        polarProductId,
        /** Where checkout gets the id: this page's record, the env var, or nowhere yet. */
        source: row ? row.source : env ? ("env" as const) : null,
        inUse: Boolean(inUse),
        differences,
        recordedAt: row?.createdAt ?? null,
        dashboardUrl: dashboardUrl(server, slug, polarProductId),
      };
    });
    return {
      server,
      tokenSet: Boolean(polarToken()),
      webhookSecretSet: Boolean(process.env.POLAR_WEBHOOK_SECRET),
      dashboardUrl: `${dashboardBase(server)}/dashboard${slug ? `/${encodeURIComponent(slug)}/products` : ""}`,
      organizationSlug: slug,
      lastCheckedAt: check?.at ?? null,
      lastError: check?.error ?? null,
      lastErrorAt: check?.errorAt ?? null,
      removed: check?.removed ?? [],
      products,
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// Checking and creating (actions: they call Polar)
// ---------------------------------------------------------------------------------------------------

/** Starts a run: the owner's role, a reason, Polar settings present, and nobody else running one. */
export const begin = internalMutation({
  args: { ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    requireReason(args.reason);
    if (!polarToken()) fail("maintenance", "Polar isn't connected on this server. Set POLAR_ACCESS_TOKEN in the Convex environment first (docs/BILLING.md).");
    const now = Date.now();
    const lock = (await settingRow(ctx, LOCK_KEY))?.value as { until: number } | undefined;
    if (lock && lock.until > now) fail("conflict", "Another Billing setup action is running. Try again in a minute.");
    await putSetting(ctx, LOCK_KEY, { until: now + LOCK_MS }, admin._id);
    const env: Partial<Record<ProductKey, string>> = {};
    for (const k of PRODUCT_KEYS) {
      const id = envProductId(k);
      if (id) env[k] = id;
    }
    return { server: polarServer(), recorded: await recordedProductIds(ctx.db), env };
  },
});

const vFinding = v.object({ key: v.string(), polarProductId: v.string(), matchedBy: v.union(v.literal("recorded"), v.literal("env"), v.literal("metadata"), v.literal("name")), differences: v.array(v.string()) });

/** Records one product this run created in Polar (right away, so a later failure never loses it). */
export const recordCreated = internalMutation({
  args: { key: v.string(), polarProductId: v.string(), server: v.union(v.literal("sandbox"), v.literal("production")), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    const reason = requireReason(args.reason);
    if (!isProductKey(args.key)) fail("invalid_argument", "Unknown product.");
    const e = expectedProduct(args.key);
    const existing = (await productRows(ctx, args.server)).find((r) => r.key === args.key);
    const fields = { key: e.key, server: args.server, polarProductId: args.polarProductId, source: "created" as const, name: e.name, type: e.type, priceCents: e.priceCents, currency: e.currency, interval: e.interval ?? undefined, seatBased: e.seatBased, differences: undefined, createdAt: Date.now(), createdBy: admin._id };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("billingProducts", fields);
    await recordAudit(ctx, admin, {
      action: "billing.product_create",
      targetType: "billing_product",
      targetId: args.key,
      reason,
      before: existing ? { polarProductId: existing.polarProductId, source: existing.source } : null,
      after: { polarProductId: args.polarProductId, server: args.server, name: e.name, type: e.type, priceCents: e.priceCents, interval: e.interval, seatBased: e.seatBased },
      requestId: args.requestId,
      clientHash: args.clientHash,
    });
  },
});

/**
 * Ends a run: records the products found that match the catalog, forgets recorded ids Polar no longer
 * lists, keeps what was found for the page, releases the lock and writes the audit entry. With `error`,
 * only the failure is recorded (and audited).
 */
export const finish = internalMutation({
  args: {
    action: v.union(v.literal("check"), v.literal("create")),
    server: v.union(v.literal("sandbox"), v.literal("production")),
    findings: v.optional(v.array(vFinding)),
    created: v.optional(v.array(v.object({ key: v.string(), polarProductId: v.string() }))),
    organizationSlug: v.optional(v.union(v.string(), v.null())),
    error: v.optional(v.string()),
    ...vRequest,
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    const reason = requireReason(args.reason);
    const now = Date.now();
    const lock = await settingRow(ctx, LOCK_KEY);
    if (lock) await ctx.db.patch(lock._id, { value: { until: 0 }, updatedAt: now });
    const prev = await lastCheck(ctx, args.server);
    const auditAction = args.action === "check" ? "billing.products_check" : "billing.products_create";
    if (args.error !== undefined) {
      await putSetting(ctx, checkKey(args.server), { ...(prev ?? { at: 0, by: admin._id, organizationSlug: null, findings: [], removed: [] }), error: args.error, errorAt: now } satisfies CheckState, admin._id);
      await recordAudit(ctx, admin, { action: auditAction, targetType: "billing_products", targetId: args.server, reason, after: { outcome: "failed", error: args.error }, requestId: args.requestId, clientHash: args.clientHash });
      return { recorded: [] as string[], removed: [] as string[] };
    }
    const findings = (args.findings ?? []).filter((f) => isProductKey(f.key)) as ProductFinding[];
    const createdKeys = new Set((args.created ?? []).map((c) => c.key));
    const rows = new Map((await productRows(ctx, args.server)).map((r) => [r.key, r]));
    const recorded: string[] = [];
    const removed: ProductKey[] = [];
    for (const f of findings) {
      if (f.differences.length) continue;
      const row = rows.get(f.key);
      if (row && row.polarProductId === f.polarProductId) continue;
      const e = expectedProduct(f.key);
      const fields = { key: e.key, server: args.server, polarProductId: f.polarProductId, source: "matched" as const, name: e.name, type: e.type, priceCents: e.priceCents, currency: e.currency, interval: e.interval ?? undefined, seatBased: e.seatBased, differences: undefined, createdAt: now, createdBy: admin._id };
      if (row) await ctx.db.replace(row._id, fields);
      else await ctx.db.insert("billingProducts", fields);
      recorded.push(f.key);
    }
    // A recorded product Polar no longer lists (archived or deleted) can't be sold; forget it so the page
    // shows what was found instead (or "Not created", and "Create missing products" can make a new one).
    // matchProducts tries the recorded id first, so a finding by anything else means it wasn't listed.
    const byKey = new Map(findings.map((f) => [f.key as string, f]));
    for (const [key, row] of rows) {
      if (!isProductKey(key) || createdKeys.has(key)) continue;
      const f = byKey.get(key);
      if (f && (f.matchedBy === "recorded" || f.differences.length === 0)) continue;
      await ctx.db.delete(row._id);
      removed.push(key);
    }
    const state: CheckState = { at: now, by: admin._id, organizationSlug: args.organizationSlug ?? prev?.organizationSlug ?? null, findings, removed, error: null, errorAt: null };
    await putSetting(ctx, checkKey(args.server), state, admin._id);
    await recordAudit(ctx, admin, {
      action: auditAction,
      targetType: "billing_products",
      targetId: args.server,
      reason,
      after: {
        outcome: "ok",
        found: findings.map((f) => ({ key: f.key, polarProductId: f.polarProductId, matchedBy: f.matchedBy, differences: f.differences.length })),
        created: args.created ?? [],
        recorded,
        removed: removed.map((k) => ({ key: k, polarProductId: rows.get(k)?.polarProductId ?? null })),
      },
      requestId: args.requestId,
      clientHash: args.clientHash,
    });
    return { recorded, removed: removed as string[] };
  },
});

// ---------------------------------------------------------------------------------------------------
// Polar requests
// ---------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** Polar's own words from an error answer: `detail` (a string or validation errors), else `error`. */
export function polarDetail(data: Json): string | null {
  const d = data.detail;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (Array.isArray(d)) {
    const msgs = d
      .map((x) => {
        const o = (x && typeof x === "object" ? x : {}) as Json;
        const loc = Array.isArray(o.loc) ? o.loc.filter((l) => l !== "body").join(".") : "";
        return typeof o.msg === "string" ? (loc ? `${loc}: ${o.msg}` : o.msg) : null;
      })
      .filter((m): m is string => Boolean(m));
    if (msgs.length) return msgs.slice(0, 3).join("; ");
  }
  if (typeof data.error_description === "string" && data.error_description) return data.error_description;
  if (typeof data.error === "string" && data.error) return data.error;
  return null;
}

/** A clear message for a failed Polar answer. */
export function polarErrorMessage(res: PolarResponse, doing: string): string {
  const detail = polarDetail(res.data);
  if (res.status === 401) return `Polar didn't accept the access token. ${SCOPE_MESSAGE}`;
  if (res.status === 403) {
    // A missing scope, or a feature the organization hasn't turned on (seat-based pricing): Polar says which.
    const scopeLike = !detail || /scope|not permitted|insufficient|forbidden|permission/i.test(detail);
    return scopeLike ? SCOPE_MESSAGE : `Polar refused ${doing}: ${detail}`;
  }
  if (res.status === 429) return "Polar is busy right now. Try again in a minute.";
  return detail ? `Polar refused ${doing}: ${detail}` : `Polar answered ${doing} with an error (HTTP ${res.status}). Try again shortly.`;
}

async function send(method: "GET" | "POST", path: string, doing: string, body?: Json): Promise<Json> {
  let res: PolarResponse;
  try {
    res = await polarSend(method, path, body);
  } catch {
    fail("maintenance", "Polar couldn't be reached. Try again shortly.");
  }
  if (!res.ok) fail(res.status === 401 || res.status === 403 ? "forbidden" : "maintenance", polarErrorMessage(res, doing));
  return res.data;
}

/** Every unarchived product of the token's organization (GET /v1/products/, 100 a page). */
async function listProducts(): Promise<Json[]> {
  const out: Json[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await send("GET", `products/?is_archived=false&limit=100&page=${page}`, "the product list");
    const items = Array.isArray(data.items) ? (data.items as unknown[]).filter((x): x is Json => Boolean(x) && typeof x === "object") : [];
    out.push(...items.filter((p) => p.is_archived !== true));
    const pagination = (data.pagination ?? {}) as Json;
    const maxPage = typeof pagination.max_page === "number" ? pagination.max_page : 1;
    if (page >= maxPage || items.length === 0) break;
  }
  return out;
}

/** The organization's slug, for dashboard links (GET /v1/organizations/{id}). Optional: without it there are no links. */
async function organizationSlug(organizationId: unknown): Promise<string | null> {
  if (typeof organizationId !== "string" || !organizationId) return null;
  try {
    const res = await polarSend("GET", `organizations/${encodeURIComponent(organizationId)}`);
    return res.ok && typeof res.data.slug === "string" && res.data.slug ? res.data.slug : null;
  } catch {
    return null;
  }
}

type RunArgs = { reason: string; requestId?: string; clientHash?: string };
type RunResult = { found: number; recorded: string[]; mismatched: string[]; created: string[]; missing: string[]; removed: string[] };

async function run(ctx: ActionCtx, args: RunArgs, mode: "check" | "create"): Promise<RunResult> {
  await requireIdentity(ctx);
  const meta = { reason: args.reason, requestId: args.requestId, clientHash: args.clientHash };
  const start = await ctx.runMutation(internal.billingSetup.begin, meta);
  const created: { key: string; polarProductId: string }[] = [];
  try {
    const listed = await listProducts();
    let findings = matchProducts(listed, { recorded: start.recorded, env: start.env });
    let orgId: unknown = listed[0]?.organization_id;
    if (mode === "create") {
      // Only products with nothing found in Polar (by recorded id, env id, metadata key or name) are made,
      // so running this twice never makes a second copy of anything.
      for (const e of EXPECTED_PRODUCTS) {
        if (findings.has(e.key)) continue;
        const product = await send("POST", "products/", `to create "${e.name}"`, productCreateBody(e));
        const id = typeof product.id === "string" ? product.id : "";
        if (!id) fail("maintenance", `Polar didn't return an id for "${e.name}". Check Polar before trying again.`);
        orgId ??= product.organization_id;
        await ctx.runMutation(internal.billingSetup.recordCreated, { key: e.key, polarProductId: id, server: start.server, ...meta });
        created.push({ key: e.key, polarProductId: id });
      }
      if (created.length) {
        const known = { ...start.recorded, ...Object.fromEntries(created.map((c) => [c.key, c.polarProductId])) };
        findings = matchProducts([...listed, ...created.map((c) => ({ id: c.polarProductId, ...productShape(c.key as ProductKey) }))], { recorded: known, env: start.env });
      }
    }
    const slug = await organizationSlug(orgId);
    const list = [...findings.values()];
    const done = await ctx.runMutation(internal.billingSetup.finish, { action: mode, server: start.server, findings: list, created, organizationSlug: slug, ...meta });
    return {
      found: list.length,
      recorded: done.recorded,
      mismatched: list.filter((f) => f.differences.length).map((f) => f.key),
      created: created.map((c) => c.key),
      missing: EXPECTED_PRODUCTS.filter((e) => !findings.has(e.key)).map((e) => e.key),
      removed: done.removed,
    };
  } catch (err) {
    const message = err instanceof Error && "data" in err && typeof (err as { data?: { message?: unknown } }).data?.message === "string" ? (err as { data: { message: string } }).data.message : "Something went wrong.";
    await ctx.runMutation(internal.billingSetup.finish, { action: mode, server: start.server, error: created.length ? `${message} (created before this: ${created.map((c) => c.key).join(", ")})` : message, ...meta });
    throw err;
  }
}

/** A just-created product as Polar describes it (what we sent), for matching without listing again. */
function productShape(key: ProductKey): Json {
  const body = productCreateBody(expectedProduct(key));
  return { ...body, is_recurring: body.recurring_interval !== null, is_archived: false };
}

/**
 * "Check Polar": lists the organization's products, matches them to the 14 products (recorded id, env id,
 * the `folevi_key` metadata, then the exact name), records the ids of those that match the catalog and
 * reports those that differ. Changes nothing in Polar.
 */
export const checkPolar = action({
  args: { ...vRequest },
  handler: async (ctx, args): Promise<RunResult> => {
    await requireIdentity(ctx);
    return await run(ctx, args, "check");
  },
});

/**
 * "Create missing products": the same check, then creates in Polar only the products with nothing found
 * and records their ids. Never edits or archives a product in Polar.
 */
export const createMissing = action({
  args: { ...vRequest },
  handler: async (ctx, args): Promise<RunResult> => {
    await requireIdentity(ctx);
    return await run(ctx, args, "create");
  },
});

/**
 * "Use this product anyway": records the product the last check found for `key` although it differs from
 * the catalog (the differences are kept with it and in the audit log). Checkout then sells it.
 */
export const useProductAnyway = mutation({
  args: { key: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    const reason = requireReason(args.reason);
    if (!isProductKey(args.key)) fail("invalid_argument", "Unknown product.");
    const server = polarServer();
    const finding = (await lastCheck(ctx, server))?.findings.find((f) => f.key === args.key);
    if (!finding || !finding.differences.length) fail("invalid_argument", "There's no differing product to use. Run Check Polar first.");
    const e = expectedProduct(args.key);
    const existing = (await productRows(ctx, server)).find((r) => r.key === args.key);
    const fields = { key: e.key, server, polarProductId: finding.polarProductId, source: "pinned" as const, name: e.name, type: e.type, priceCents: e.priceCents, currency: e.currency, interval: e.interval ?? undefined, seatBased: e.seatBased, differences: finding.differences, createdAt: Date.now(), createdBy: admin._id };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("billingProducts", fields);
    await recordAudit(ctx, admin, {
      action: "billing.product_pin",
      targetType: "billing_product",
      targetId: args.key,
      reason,
      before: existing ? { polarProductId: existing.polarProductId, source: existing.source } : null,
      after: { polarProductId: finding.polarProductId, server, differences: finding.differences },
      requestId: args.requestId,
      clientHash: args.clientHash,
    });
    return null;
  },
});
