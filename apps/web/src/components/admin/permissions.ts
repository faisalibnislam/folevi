// Client-side mirror of the platform-role checks in convex/admin.ts. It only decides what the UI
// offers; the server enforces every rule again (and answers `not_found` to anyone without a role).

export type AdminRole = "super_admin" | "support_admin" | "ops_admin";

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super admin",
  support_admin: "Support admin",
  ops_admin: "Ops admin",
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
  | "deletionJobs.view";

const ALL: AdminRole[] = ["super_admin", "support_admin", "ops_admin"];
const SUPPORT: AdminRole[] = ["super_admin", "support_admin"];
const OPS: AdminRole[] = ["super_admin", "ops_admin"];
const SUPER: AdminRole[] = ["super_admin"];

export const PERMISSIONS: Record<Capability, AdminRole[]> = {
  "dashboard.view": ALL,
  "users.view": SUPPORT,
  "users.act": SUPPORT,
  "users.setRole": SUPER,
  "workspaces.view": ALL,
  "workspaces.suspend": ALL,
  "workspaces.quota": OPS,
  "emails.view": ALL,
  "emails.resend": SUPPORT,
  "config.view": ALL,
  "config.edit": OPS,
  "audit.view": ALL,
  "audit.viewAll": SUPER,
  "deletionJobs.view": ALL,
};

export function can(role: AdminRole, capability: Capability): boolean {
  return PERMISSIONS[capability].includes(role);
}

/** Human explanation used next to disabled controls. */
export function rolesFor(capability: Capability): string {
  const names = PERMISSIONS[capability].map((r) => ROLE_LABEL[r].toLowerCase());
  if (names.length === 1) return `Only a ${names[0]} can do this.`;
  return `Only a ${names.slice(0, -1).join(", ")} or ${names.at(-1)} can do this.`;
}
