"use client";

// A tabs block on a read-only page (shared pages, slides): the same tab strip as the editor's, and each tab's
// blocks as a tabpanel. Readers switch tabs (click, arrow keys, Home, End); the open tab is remembered on the
// device like the editor's (tabs/tabsState.ts).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { storedTab, storeTab } from "@/components/editor/tabs/tabsState";
import "@/components/editor/tabs/tabs.css";

export function ReadOnlyTabs({ id, tabs, panels, style }: { id: string; tabs: { id: string; name: string }[]; panels: ReactNode[]; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(tabs[0]?.id ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  // The tab this device opened last (after the first paint, which matches the server's).
  useEffect(() => {
    const stored = storedTab(id);
    if (stored && tabs.some((t) => t.id === stored)) setOpen(stored);
  }, [id, tabs]);

  const choose = (tabId: string, focus: boolean) => {
    setOpen(tabId);
    storeTab(id, tabId);
    if (focus) requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"]`)?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    choose(tabs[to]!.id, true);
  };

  return (
    <div className="fb-readonly-tabs" style={style} data-tabs-id={id}>
      <div className="fb-tabs">
        <div className="fb-tabs-bar">
          <div ref={listRef} role="tablist" aria-label="Tabs" className="fb-tabs-list">
            {tabs.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${uid}-tab-${i}`}
                data-tab-id={t.id}
                aria-selected={t.id === open}
                aria-controls={`${uid}-panel-${i}`}
                tabIndex={t.id === open ? 0 : -1}
                className={`fb-tab-button ${t.id === open ? "is-open" : ""}`}
                onClick={() => choose(t.id, false)}
                onKeyDown={(e) => onKeyDown(e, i)}
              >
                <span className="fb-tab-name">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {tabs.map((t, i) => (
        <div key={t.id} id={`${uid}-panel-${i}`} role="tabpanel" aria-labelledby={`${uid}-tab-${i}`} tabIndex={0} hidden={t.id !== open} className="fb-tab-panel">
          {panels[i]}
        </div>
      ))}
    </div>
  );
}
