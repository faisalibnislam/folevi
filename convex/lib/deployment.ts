// Which kind of deployment this is, from FOLEVI_ENV. Development tools (the dev mailbox, test purchases,
// seeding, loosened rate limits, stand-in secrets) are allowed only where FOLEVI_ENV names a
// non-production deployment. Anything else is production, including a variable that is unset, empty or
// mistyped, so losing the variable can never switch those tools on. No imports, so anything can load it.

const NON_PRODUCTION = ["development", "test", "preview"] as const;
export type Deployment = "production" | (typeof NON_PRODUCTION)[number];

/** The deployment named by a FOLEVI_ENV value; production unless it names a non-production one. */
export function deploymentOf(value: string | undefined): Deployment {
  const name = (value ?? "").trim().toLowerCase();
  return (NON_PRODUCTION as readonly string[]).includes(name) ? (name as Deployment) : "production";
}

/** This deployment (scripts/setup-local.mjs sets "development", the tests set "test"). */
export function deployment(): Deployment {
  return deploymentOf(process.env.FOLEVI_ENV);
}

/** True unless FOLEVI_ENV names a development, test or preview deployment. */
export function isProductionDeployment(): boolean {
  return deployment() === "production";
}
