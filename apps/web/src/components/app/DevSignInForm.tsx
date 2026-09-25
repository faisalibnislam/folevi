/** Development-only sign-in form (never rendered when dev auth is disabled). */
export function DevSignInForm({ returnTo, mode }: { returnTo: string; mode: "signin" | "signup" }) {
  return (
    <form action="/api/dev-auth/session" method="post" className="mt-6 space-y-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="rounded-[10px] border border-warning/30 bg-warning-soft p-3 text-xs text-ink">
        <strong>Development sign-in.</strong> No identity provider is configured, so this local-only form stands in for Auth0 (email verification and authenticator codes are simulated). It is disabled in production.
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input name="email" type="email" required autoComplete="email" defaultValue="ada@example.com" className="h-10 w-full rounded-[8px] border border-line bg-surface px-3" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Name</span>
        <input name="name" autoComplete="name" defaultValue="Ada Example" className="h-10 w-full rounded-[8px] border border-line bg-surface px-3" />
      </label>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Simulate account states</summary>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" name="simulateUnverified" /> Email not verified yet
        </label>
        <label className="mt-1 flex items-center gap-2">
          <input type="checkbox" name="simulateMfaMissing" /> Two-step verification not completed
        </label>
      </details>
      <button type="submit" className="h-10 w-full rounded-[8px] bg-accent text-sm font-medium text-accent-ink">
        {mode === "signup" ? "Create development account" : "Sign in (development)"}
      </button>
    </form>
  );
}
