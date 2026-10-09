"use client";
// The Mac app's Quick Add window (⌥Space from any app): the Quick add task form alone, sized to fit. It
// starts fresh each time it's shown, Escape or Cancel puts it away, and a task added says where it went
// with a Mac notification (click it to open the page). Opened in a browser, it's a page of its own.
import { useEffect, useRef, useState } from "react";
import { useAppRouter } from "@/lib/app/router";
import { desktop } from "@/lib/desktop";
import { QuickAddForm } from "./QuickAddTask";

export function DesktopQuickAdd() {
  const bridge = desktop();
  const { navigate } = useAppRouter();
  const [round, setRound] = useState(0);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => bridge?.onCommand((c) => c.type === "quick-add-shown" && setRound((r) => r + 1)), [bridge]);

  // The window is as tall as the form (it grows when a time field or the page list appears).
  useEffect(() => {
    const el = panel.current;
    if (!el || !bridge) return;
    const report = () => bridge.sizeQuickAdd(Math.ceil(el.getBoundingClientRect().height));
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [bridge]);

  const close = () => (bridge ? bridge.closeQuickAdd() : navigate("/documents"));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main ref={panel} aria-labelledby="quick-add-heading" className={`ui-canvas text-ink ${bridge ? "ui-desktop-quick-add" : "mx-auto mt-16 max-w-lg rounded-[12px] shadow-[var(--glass-edge)]"} p-5`}>
      <div className="ui-drag mb-4 flex items-baseline justify-between gap-3">
        <h1 id="quick-add-heading" className="ui-display text-[19px] text-heading">
          Quick add task
        </h1>
        <p className="text-xs text-muted">Tasks without a page go to your Inbox.</p>
      </div>
      <QuickAddForm
        key={round}
        onClose={close}
        onAdded={({ documentId, where }) => {
          if (bridge) bridge.notify({ id: `quick-add-${documentId}-${Date.now()}`, title: `Task added to ${where}`, path: `/d/${documentId}` });
          else navigate(`/d/${documentId}`);
        }}
      />
    </main>
  );
}
