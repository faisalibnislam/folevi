// Whether a library on this device has a Vault (docs/MAC_REBUILD_PLAN.md §0, "Vault without an account"). Like the
// account Vault's "vault" flag it's held back until the outside security review (docs/VAULT_PLAN.md §11.7): on in
// builds that talk to the development backend, off in production builds unless NEXT_PUBLIC_LOCAL_VAULT is "on".
const PRODUCTION_DEPLOYMENT = "fastidious-clownfish-123";

export function localVaultEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_LOCAL_VAULT;
  if (flag === "on") return true;
  if (flag === "off") return false;
  return !(process.env.NEXT_PUBLIC_CONVEX_URL ?? "").includes(PRODUCTION_DEPLOYMENT);
}
