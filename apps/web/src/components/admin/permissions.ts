// Client-side mirror of the platform-role checks in convex/admin.ts, adminBilling.ts, billingSetup.ts, adminAnalytics.ts and support.ts.
// It only decides what the UI offers; the server enforces every rule again (and answers `not_found` to anyone
// without a role). Three tiers. The stored names predate the labels and are kept so existing roles still work:
//   Owner (super_admin) ⊃ Admin (ops_admin) ⊃ Support staff (support_admin).

export type AdminRole = "super_admin" | "support_admin" | "ops_admin";

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Owner",
  ops_admin: "Admin",
  support_admin: "Support staff",
};

export type Capability =
  | "dashboard.view"
  | "users.view"
  | "users.act"
  | "users.setRole"
  | "workspaces.view"
  | "workspaces.suspend"
  | "workspaces.quota"
  | "emails.view"
  | "emails.resend"
  | "config.view"
  | "config.edit"
  | "audit.view"
  | "audit.viewAll"
  | "deletionJobs.view"
  | "users.manage"
  | "billing.view"
  | "billing.trial"
  | "billing.manage"
  | "billing.credits"
  | "billing.refund"
  | "billing.setup"
  | "users.export"
  | "analytics.view"
  | "revenue.view"
  | "config.maintenance"
  | "support.view"
  | "support.reply";

const ALL: AdminRole[] = ["super_admin", "ops_admin", "support_admin"];
const ADMIN: AdminRole[] = ["super_admin", "ops_admin"];
const OWNER: AdminRole[] = ["super_admin"];

export const PERMISSIONS: Record<Capability, AdminRole[]> = {
  "dashboard.view": ALL,
  "users.view": ALL,
  /** Resend verification, password reset (at the person's request). */
  "users.act": ALL,
  /** Suspend, revoke sessions, schedule deletion. */
  "users.manage": ADMIN,
  "users.setRole": OWNER,
  "users.export": ALL,
  "workspaces.view": ALL,
  "workspaces.suspend": ADMIN,
  "workspaces.quota": ADMIN,
  "emails.view": ALL,
  "emails.resend": ALL,
  "config.view": ALL,
  "config.edit": ADMIN,
  "config.maintenance": OWNER,
  "audit.view": ALL,
  "audit.viewAll": OWNER,
  "deletionJobs.view": ADMIN,
  "billing.view": ALL,
  /** Give or extend a Pro AI trial (support staff up to 14 days, admins up to 90). */
  "billing.trial": ALL,
  /** Set plans by hand, override storage and device limits. */
  "billing.manage": ADMIN,
  /** Grant AI credits (Personal, or a seat in a paid workspace); mirrors adminBilling.grantCredits. */
  "billing.credits": ADMIN,
  "billing.refund": OWNER,
  /** Billing setup: the Polar connection and products; check Polar, create missing products (mirrors billingSetup.ts). */
  "billing.setup": OWNER,
  "analytics.view": ALL,
  "revenue.view": ADMIN,
  /** The Support inbox and tickets (each ticket view is audited). */
  "support.view": ALL,
  /** Reply to the requester (emailed), add internal notes, change status, assign to yourself. */
  "support.reply": ALL,
};

/** The longest trial extension each role may give (mirrors adminBilling.extendTrial). */
export function maxTrialDays(role: AdminRole): number {
  return role === "support_admin" ? 14 : 90;
}

export function can(role: AdminRole, capability: Capability): boolean {
  return PERMISSIONS[capability].includes(role);
}

/** Human explanation used next to disabled controls. */
export function rolesFor(capability: Capability): string {
  const roles = PERMISSIONS[capability];
  if (roles.length === 1) return `Only the ${ROLE_LABEL[roles[0]!].toLowerCase()} can do this.`;
  if (roles.length === 2) return "Only owners and admins can do this.";
  return "Anyone with console access can do this.";
}
