"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { FoleviLogo } from "@/components/brand/FoleviMark";

const STEPS = ["Your Personal space", "Choose an appearance", "Open your first page"] as const;

export function Onboarding() {
  const { profile, setContext, setAppearance, appearance } = useAppState();
  const { navigate } = useAppRouter();
  const complete = useMutation(api.users.completeOnboardingStep);
  // A new account starts in Personal, where its first pages were added.
  const docs = useQuery(api.documents.list, { scope: { kind: "personal" }, view: "all", paginationOpts: { numItems: 20, cursor: null } });
  const stepIndex = profile.onboardingStep === "workspace" ? 0 : profile.onboardingStep === "appearance" ? 1 : 2;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const welcome = docs?.page.find((d) => d.title === "Welcome to Folevi") ?? docs?.page[0];

  return (
    <main id="main" tabIndex={-1} className="ui-canvas grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-2 text-ink">
          <FoleviLogo height={28} className="text-heading" />
        </div>
        <div className="relative">
          {/* Offset leaves behind the sheet echo the folio mark. */}
          <div aria-hidden className="absolute inset-0 translate-x-3 translate-y-3 ui-well rounded-[10px]" />
          <div aria-hidden className="absolute inset-0 translate-x-1.5 translate-y-1.5 ui-card rounded-[10px]" />
          <section className="relative ui-card rounded-[10px] p-8 animate-[folio-settle_320ms_var(--ease-folio)]" aria-labelledby="onboarding-title">
            <ol className="mb-8 flex gap-2" aria-label="Setup progress">
              {STEPS.map((label, i) => (
                <li key={label} className="flex-1">
                  <div className={`h-1 rounded-full ${i <= stepIndex ? "bg-accent" : "bg-sunken"}`} />
                  <span className="sr-only">
                    Step {i + 1} of 3: {label}
                    {i < stepIndex ? " (done)" : i === stepIndex ? " (current)" : ""}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-sm text-muted">Step {stepIndex + 1} of 3</p>
            <h1 id="onboarding-title" className="mt-1 ui-display text-4xl leading-tight">
              {stepIndex === 0 ? `Welcome, ${profile.displayName.split(" ")[0]}.` : stepIndex === 1 ? "How should Folevi look?" : "Your folio is ready."}
            </h1>

            {stepIndex === 0 ? (
              <form
                className="mt-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => complete({ step: "workspace" }));
                }}
              >
                <div className="flex items-center gap-3 rounded-[6px] bg-sunken px-4 py-3">
                  <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-heading text-[15px] font-semibold text-canvas">
                    {profile.displayName.trim().slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-heading">Personal</span>
                    <span className="block text-sm text-muted">Your own space for notes, folders and tasks. Share single pages with anyone, or create a workspace for a team any time from the menu at the bottom of the sidebar.</span>
                  </span>
                </div>
                <div className="mt-6 flex justify-end">
                  <Button type="submit" variant="primary" disabled={busy}>
                    Continue
                  </Button>
                </div>
              </form>
            ) : null}

            {stepIndex === 1 ? (
              <div className="mt-6">
                <fieldset>
                  <legend className="text-sm text-muted">You can change this later in Settings.</legend>
                  <div className="mt-3 grid grid-cols-3 gap-3" role="radiogroup" aria-label="Appearance">
                    {(
                      [
                        ["light", "Light", <Sun key="s" size={18} />],
                        ["dark", "Dark", <Moon key="m" size={18} />],
                        ["system", "Match system", <Monitor key="d" size={18} />],
                      ] as const
                    ).map(([value, label, icon]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={appearance === value}
                        onClick={() => setAppearance(value)}
                        className={`flex flex-col items-center gap-2 rounded-[6px] border p-4 text-sm transition-colors ${appearance === value ? "border-accent bg-accent-soft text-accent-soft-ink" : "border-line bg-surface transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]"}`}
                      >
                        {icon}
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="mt-6 flex justify-end">
                  <Button variant="primary" disabled={busy} onClick={() => void run(() => complete({ step: "appearance", appearance }))}>
                    Continue
                  </Button>
                </div>
              </div>
            ) : null}

            {stepIndex === 2 ? (
              <div className="mt-4">
                <p className="text-muted">
                  We added a few pages to start from: a welcome guide, field notes, a project brief, a reading shelf and a trip sketch with tasks. Keep what helps, delete the rest.
                </p>
                <div className="mt-6 flex justify-end">
                  <Button
                    variant="primary"
                    disabled={busy || !docs}
                    onClick={() =>
                      void run(async () => {
                        await complete({ step: "welcome" });
                        setContext({ kind: "personal" });
                        navigate(welcome ? `/d/${welcome.id}` : "/documents", { replace: true });
                      })
                    }
                  >
                    Open “Welcome to Folevi”
                  </Button>
                </div>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="mt-4 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
