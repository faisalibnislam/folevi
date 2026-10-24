"use client";
// The Mac app's Quick Add window (⌥Space from any app): one growing field (MacQuickAdd, docs/MAC_POLISH_PLAN.md
// §3.8), sized to fit. It starts fresh each time it's shown and Escape puts it away. Opened in a browser, it's a
// page of its own with the Quick add task form, and a task added opens its page.
import { useEffect, useState } from "react";
import { useAppRouter } from "@/lib/app/router";
import { desktop } from "@/lib/desktop";
import { QuickAddForm } from "./QuickAddTask";
import { MacQuickAdd } from "./MacQuickAdd";
import { Select } from "@/components/ui/Select";
import { shell } from "@/lib/shell";
import { deviceWords } from "@/lib/shell/words";
import { usePlaces } from "@/lib/places";

export function DesktopQuickAdd() {
  const bridge = desktop();
  const { navigate } = useAppRouter();
  const [round, setRound] = useState(0);

  useEffect(() => bridge?.onCommand((c) => c.type === "quick-add-shown" && setRound((r) => r + 1)), [bridge]);

  const close = () => (bridge ? bridge.closeQuickAdd() : navigate("/documents"));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (bridge) return <MacQuickAdd round={round} place={<QuickAddPlace />} />;
  return (
    <main aria-labelledby="quick-add-heading" className="ui-canvas mx-4 mt-16 max-w-lg rounded-panel p-5 text-ink shadow-[var(--glass-edge)] sm:mx-auto">
      <div className="ui-drag mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 id="quick-add-heading" className="ui-display whitespace-nowrap text-title-3 text-heading">
          Quick add task
        </h1>
        <p className="text-footnote text-muted">Tasks without a page go to your Inbox.</p>
      </div>
      <QuickAddPlace />
      <QuickAddForm
        key={round}
        onClose={close}
        onAdded={({ documentId }) => navigate(`/d/${documentId}`)}
      />
    </main>
  );
}

/**
 * Several places (docs/MULTI_ACCOUNT_PLAN.md §6): which place the task goes to, remembered for next time. Picking
 * another opens Quick Add again in that place (its session and its notes are that place's).
 */
function QuickAddPlace() {
  const host = shell()?.places;
  const { places, current } = usePlaces();
  if (!host?.setQuickAddPlace || places.length < 2) return null;
  const label = (p: (typeof places)[number]) => (p.kind === "library" ? `On ${deviceWords().here}` : p.name || p.email || "Folevi account");
  return (
    <div className="mb-3 flex items-center gap-2 text-subheadline text-muted">
      <span>Add to</span>
      <Select aria-label="Add to" value={current ?? ""} onChange={(e) => void host.setQuickAddPlace?.(e.target.value)} className="min-w-0 flex-1">
        {places.map((p) => (
          <option key={p.id} value={p.id}>
            {label(p)}
          </option>
        ))}
      </Select>
    </div>
  );
}
