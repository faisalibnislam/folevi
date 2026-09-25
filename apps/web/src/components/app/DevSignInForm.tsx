/** Development-only sign-in form (never rendered when dev auth is disabled). */
export function DevSignInForm({ returnTo, mode }: { returnTo: string; mode: "signin" | "signup" }) {
  return (
    <form action="/api/dev-auth/session" method="post" className="mt-6 space-y-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="rounded-[14px] bg-warning-soft p-3 text-xs text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-warning)_22%,transparent)]">
        <strong>Development sign-in.</strong> No identity provider is configured, so this local-only form stands in for Auth0 (email verification and authenticator codes are simulated). It is disabled in production.
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input name="email" type="email" required autoComplete="email" defaultValue="ada@example.com" className="ui-input h-11 w-full rounded-full px-4" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Name</span>
        <input name="name" autoComplete="name" defaultValue="Ada Example" className="ui-input h-11 w-full rounded-full px-4" />
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
      <button type="submit" className="ui-btn ui-btn-primary h-11 w-full text-sm">
        {mode === "signup" ? "Create development account" : "Sign in (development)"}
      </button>
    </form>
  );
}
