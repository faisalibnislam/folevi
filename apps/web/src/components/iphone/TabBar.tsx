"use client";

import { CalendarDays, FilePlus2, FolderPlus, House, LayoutTemplate, ListPlus, Plus, SquareCheckBig } from "lucide-react";
import { useAppRouter, type Route } from "@/lib/app/router";
import { useShell } from "@/components/app/Shell";
import { useCreateDocument } from "@/components/app/useCreateDocument";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAiEnabled } from "@/components/ai/useAi";
import { MenuButton } from "@/components/ui/Menu";
import { haptic } from "@/lib/nativeApp";
import { SCROLL_TOP_EVENT, useIphoneChrome } from "./chrome";
import { markTabSwitch } from "./transitions";

type Tab = "home" | "tasks" | "calendar";

/** Which tab a screen belongs to: Tasks and Calendar have their own; everything else is under Home. */
export function tabOf(route: Route): Tab {
  return route.name === "tasks" ? "tasks" : route.name === "calendar" ? "calendar" : "home";
}

/** A tab's first screen. */
export function isTabRoot(route: Route): boolean {
  return route.name === "documents" || route.name === "tasks" || route.name === "calendar";
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
  const current = tabOf(route);
  const hidden = keyboard || tabBarHidden || route.name === "doc" || route.name === "ai";

  const pick = (tab: (typeof TABS)[number]) => {
    if (tab.id === current) {
      // The tab you're on: back to its first screen, or (already there) to the top.
      if (isTabRoot(route)) window.dispatchEvent(new Event(SCROLL_TOP_EVENT));
      else {
        markTabSwitch();
        navigate(tab.href);
      }
      return;
    }
    haptic("light");
    markTabSwitch();
    navigate(tab.href);
  };

  const plus = "grid h-[38px] w-[38px] place-items-center rounded-capsule bg-heading text-canvas shadow-[0_2px_6px_rgb(0_0_0/0.18)]";
  return (
    <div
      aria-hidden={hidden || undefined}
      inert={hidden}
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-end justify-between gap-3 px-4 pb-[max(10px,calc(env(safe-area-inset-bottom)-10px))] pl-[calc(16px+env(safe-area-inset-left))] pr-[calc(16px+env(safe-area-inset-right))] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${hidden ? "translate-y-[140%] opacity-0" : ""}`}
    >
      <nav aria-label="Tabs" className="ui-liquid pointer-events-auto flex h-[60px] items-center gap-0.5 rounded-capsule p-1">
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
              className={`grid h-[52px] w-[60px] place-items-center rounded-capsule outline-none transition-[background-color,color,transform] duration-200 active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-focus ${on ? "bg-[var(--liquid-active)] text-heading" : "text-muted"}`}
            >
              {tab.icon(on)}
            </a>
          );
        })}
      </nav>
      <div role="group" aria-label="Create" className="ui-liquid pointer-events-auto flex h-[60px] items-center gap-1 rounded-capsule p-1">
        {aiOn ? (
          <button
            type="button"
            aria-label="Foli AI"
            onClick={() => {
              haptic("light");
              openAsk();
            }}
            className="grid h-[52px] w-[52px] place-items-center rounded-capsule outline-none transition-transform active:scale-[0.92] focus-visible:ring-2 focus-visible:ring-focus"
          >
            <AiIcon size={26} />
          </button>
        ) : null}
        {current === "tasks" ? (
          <button type="button" aria-label="Quick task" onClick={() => openQuickAdd()} className="grid h-[52px] w-[52px] place-items-center rounded-capsule outline-none transition-transform active:scale-[0.92] focus-visible:ring-2 focus-visible:ring-focus">
            <span className={plus}>
              <Plus size={22} strokeWidth={2.6} aria-hidden />
            </span>
          </button>
        ) : (
          <MenuButton
            label="Create"
            side="top"
            align="end"
            triggerClassName="grid h-[52px] w-[52px] place-items-center rounded-capsule outline-none transition-transform active:scale-[0.92] focus-visible:ring-2 focus-visible:ring-focus"
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
