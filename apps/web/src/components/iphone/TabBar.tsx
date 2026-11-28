"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, FilePlus2, FolderPlus, House, LayoutTemplate, ListPlus, Plus, SquareCheckBig } from "lucide-react";
import { useAppRouter } from "@/lib/app/router";
import { useShell } from "@/components/app/Shell";
import { useCreateDocument } from "@/components/app/useCreateDocument";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAiEnabled } from "@/components/ai/useAi";
import { MenuButton } from "@/components/ui/Menu";
import { SCROLL_TOP_EVENT, useIphoneChrome } from "./chrome";
import { READY_WAIT_MS, linear, markBackButton, moveIsComing, onMoveStart, track } from "./transitions";
import { resetToRoot, selectTab, stackDepth, useCurrentTab, type Tab } from "./tabStacks";
import { SPRINGS, springCss, type Spring } from "@/lib/native/physics";
import { feel } from "@/lib/native/ui";

/** The lens moving to the tab you picked: a menu-like spring with a little overshoot (iOS 26's tab bar). */
const LENS = springCss(SPRINGS.menu);

/** How far below its place the hidden bar sits, in its own heights. */
const DROP = 1.4;

const reduced = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The bar going away or coming back, in step with the screens: it moves when a push or pop really starts (after
 * the wait for a note's words) and on the same spring, so it never leaves before the screen does. Otherwise
 * (the keyboard, Select mode) it moves at once on the push spring. Reduce Motion: no movement.
 */
function useTabBarMotion(hidden: boolean) {
  const bar = useRef<HTMLDivElement>(null);
  // Where the bar is drawn (hidden or not), which trails `hidden` while a move is coming.
  const [down, setDown] = useState(hidden);
  const next = useRef<{ from: { y: number; opacity: number } | null; spring: Spring } | null>(null);

  useLayoutEffect(() => {
    if (hidden === down) return;
    let done = false;
    const go = (spring: Spring | null) => {
      if (done) return;
      done = true;
      const el = bar.current;
      // From wherever it is now, mid-move included.
      let from: { y: number; opacity: number } | null = null;
      if (el && typeof el.animate === "function" && typeof DOMMatrixReadOnly !== "undefined" && !reduced()) {
        const style = getComputedStyle(el);
        from = { y: new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform).m42, opacity: Number(style.opacity) };
      }
      next.current = { from, spring: spring ?? SPRINGS.push };
      setDown(hidden);
    };
    if (!moveIsComing()) {
      go(null);
      return;
    }
    const stop = onMoveStart(go);
    // (A move that never starts doesn't keep the bar where it was.)
    const timer = window.setTimeout(() => go(null), READY_WAIT_MS + 250);
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [hidden, down]);

  // The move itself, once the bar's resting place (its style) is drawn: a Web Animation of transform and
  // opacity on the spring, sampled into keyframes as the screens' are.
  useLayoutEffect(() => {
    const el = bar.current;
    const plan = next.current;
    next.current = null;
    if (!el || !plan || !plan.from) return;
    for (const a of el.getAnimations()) a.cancel();
    const toY = down ? el.offsetHeight * DROP : 0;
    const toOpacity = down ? 0 : 1;
    const { y, opacity } = plan.from;
    if (Math.abs(y - toY) < 0.5 && Math.abs(opacity - toOpacity) < 0.01) return;
    const move = track(plan.spring, (k) => ({
      transform: `translateY(${Math.round((y + (toY - y) * k) * 100) / 100}px)`,
      opacity: Math.round(Math.min(1, Math.max(0, opacity + (toOpacity - opacity) * k)) * 1000) / 1000,
    }));
    el.animate(move.frames, linear(move.ms));
  }, [down]);

  return { bar, down };
}

const TABS: { id: Tab; label: string; href: string; icon: (on: boolean) => React.ReactNode }[] = [
  { id: "home", label: "Home", href: "/documents", icon: (on) => <House size={24} strokeWidth={on ? 2.3 : 1.9} aria-hidden /> },
  { id: "tasks", label: "Tasks", href: "/tasks/today", icon: (on) => <SquareCheckBig size={23} strokeWidth={on ? 2.3 : 1.9} aria-hidden /> },
  { id: "calendar", label: "Calendar", href: "/calendar", icon: (on) => <CalendarDays size={23} strokeWidth={on ? 2.3 : 1.9} aria-hidden /> },
];

/**
 * The floating tab bar: Home, Tasks and Calendar in one glass capsule on the left, Foli AI and + in another
 * on the right. It floats above the home indicator, and steps out of the way for the keyboard, a note (which
 * has its own bars) and Select mode. + opens New note, From template, New folder and Quick task (on Tasks it
 * goes straight to Quick task).
 */
export function TabBar({ onNewFolder }: { onNewFolder: () => void }) {
  const { route, navigate } = useAppRouter();
  const { openAsk, openQuickAdd } = useShell();
  const aiOn = useAiEnabled();
  const { keyboard, tabBarHidden } = useIphoneChrome();
  const createDocument = useCreateDocument();
  const current = useCurrentTab();
  const hidden = keyboard || tabBarHidden || route.name === "doc" || route.name === "ai";
  const lens = TABS.findIndex((t) => t.id === current);
  const { bar, down } = useTabBarMotion(hidden);

  const pick = (tab: (typeof TABS)[number]) => {
    if (tab.id === current) {
      // The tab you're on: back to its first screen (sliding, as iOS pops to the root), or, already
      // there, to the top.
      const { depth, rootIsTab } = stackDepth();
      if (depth === 0 && rootIsTab) window.dispatchEvent(new Event(SCROLL_TOP_EVENT));
      else if (!rootIsTab) resetToRoot();
      else {
        markBackButton();
        window.history.go(-depth);
      }
      return;
    }
    feel("choose");
    // Where you left it: its own stack of screens (tabStacks.ts).
    selectTab(tab.id);
  };

  const plus = "grid h-10 w-10 place-items-center rounded-capsule bg-heading text-canvas shadow-[var(--shadow-raised)]";
  return (
    <div
      ref={bar}
      aria-hidden={hidden || undefined}
      inert={hidden}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-end justify-between gap-3 px-4 pb-[max(10px,calc(env(safe-area-inset-bottom)-10px))] pl-[calc(16px+env(safe-area-inset-left))] pr-[calc(16px+env(safe-area-inset-right))]"
      style={down ? { transform: `translateY(${DROP * 100}%)`, opacity: 0 } : undefined}
    >
      <nav aria-label="Tabs" className="ui-liquid iphone-tab-pill pointer-events-auto flex h-16 items-center gap-0.5 rounded-capsule p-1">
        {/* The current tab sits in a glass lens that slides to the tab you pick (each tab is 64 px, 2 px apart), on a spring. */}
        {lens >= 0 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-1 top-1 h-14 w-16 rounded-capsule bg-[var(--liquid-lens)] shadow-[inset_0_1px_0_rgb(255_255_255/0.55),inset_0_0_0_0.5px_rgb(255_255_255/0.35)] motion-reduce:transition-none dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.14),inset_0_0_0_0.5px_rgb(255_255_255/0.08)]"
            style={{ transform: `translateX(${lens * 66}px)`, transition: `transform ${LENS.ms}ms ${LENS.easing}` }}
          />
        ) : null}
        {TABS.map((tab) => {
          const on = tab.id === current;
          return (
            <a
              key={tab.id}
              href={tab.href}
              aria-label={tab.label}
              aria-current={on ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                pick(tab);
              }}
              className={`ui-glass-press relative grid h-14 w-16 place-items-center rounded-capsule outline-none focus-visible:ring-2 focus-visible:ring-focus ${on ? "text-heading" : "text-muted"}`}
            >
              {tab.icon(on)}
            </a>
          );
        })}
      </nav>
      <div role="group" aria-label="Create" className="ui-liquid iphone-tab-pill pointer-events-auto flex h-16 items-center gap-1 rounded-capsule p-1">
        {aiOn ? (
          <button
            type="button"
            aria-label="Foli AI"
            onClick={() => {
              feel("toggle");
              openAsk();
            }}
            className="ui-glass-press grid h-14 w-14 place-items-center rounded-capsule outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <AiIcon size={26} />
          </button>
        ) : null}
        {current === "tasks" ? (
          <button type="button" aria-label="Quick task" onClick={() => openQuickAdd()} className="ui-glass-press grid h-14 w-14 place-items-center rounded-capsule outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <span className={plus}>
              <Plus size={22} strokeWidth={2.6} aria-hidden />
            </span>
          </button>
        ) : (
          <MenuButton
            label="Create"
            side="top"
            align="end"
            triggerClassName="ui-glass-press grid h-14 w-14 place-items-center rounded-capsule outline-none focus-visible:ring-2 focus-visible:ring-focus"
            menuClassName="!min-w-[15.5rem]"
            trigger={
              <span className={plus}>
                <Plus size={22} strokeWidth={2.6} aria-hidden />
              </span>
            }
            items={[
              { label: "New note", icon: <FilePlus2 size={18} />, onSelect: () => void createDocument({}) },
              { label: "From template", icon: <LayoutTemplate size={18} />, onSelect: () => navigate("/templates") },
              { label: "New folder", icon: <FolderPlus size={18} />, onSelect: onNewFolder },
              { label: "Quick task", icon: <ListPlus size={18} />, onSelect: () => openQuickAdd() },
            ]}
          />
        )}
      </div>
    </div>
  );
}
