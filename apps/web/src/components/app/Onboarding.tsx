"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { FoleviMark } from "@/components/brand/FoleviMark";

const STEPS = ["Name your workspace", "Choose an appearance", "Open your first page"] as const;

export function Onboarding() {
  const { profile, workspace, setAppearance, appearance } = useAppState();
  const { navigate } = useAppRouter();
  const complete = useMutation(api.users.completeOnboardingStep);
  const docs = useQuery(api.documents.list, { workspaceId: workspace.id, view: "all", paginationOpts: { numItems: 20, cursor: null } });
  const stepIndex = profile.onboardingStep === "workspace" ? 0 : profile.onboardingStep === "appearance" ? 1 : 2;
  const [name, setName] = useState(workspace.name);
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
    <main id="main" tabIndex={-1} className="folio-lines grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-2 text-ink">
          <FoleviMark size={26} accent="var(--color-accent)" />
          <span className="font-display text-2xl">Folevi</span>
        </div>
        <div className="relative">
          {/* Offset leaves behind the sheet echo the folio mark. */}
          <div aria-hidden className="absolute inset-0 translate-x-3 translate-y-3 rounded-[14px] border border-line bg-sunken" />
          <div aria-hidden className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-[14px] border border-line bg-surface" />
          <section className="relative rounded-[14px] border border-line bg-raised p-8 animate-[folio-settle_320ms_var(--ease-folio)]" aria-labelledby="onboarding-title">
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
            <h1 id="onboarding-title" className="mt-1 font-display text-4xl leading-tight">
              {stepIndex === 0 ? `Welcome, ${profile.displayName.split(" ")[0]}.` : stepIndex === 1 ? "How should Folevi look?" : "Your folio is ready."}
            </h1>

            {stepIndex === 0 ? (
              <form
                className="mt-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => complete({ step: "workspace", workspaceName: name }));
                }}
              >
                <label htmlFor="ws-name" className="block text-sm font-medium">
                  Name your workspace
                </label>
                <p id="ws-name-hint" className="text-sm text-muted">
                  This is your personal space. You can rename it any time.
                </p>
                <input
                  id="ws-name"
                  aria-describedby="ws-name-hint"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                  autoFocus
                  className="mt-2 h-11 w-full rounded-[8px] border border-line bg-surface px-3 text-base outline-none focus:border-accent"
                />
                <div className="mt-6 flex justify-end">
                  <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
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
                        className={`flex flex-col items-center gap-2 rounded-[10px] border p-4 text-sm transition-colors ${appearance === value ? "border-accent bg-accent-soft text-accent-soft-ink" : "border-line bg-surface hover:border-line-strong"}`}
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
