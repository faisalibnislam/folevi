"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useAppRouter, type Route } from "@/lib/app/router";
import { GlassCircle } from "./Glass";
import { SCROLL_TOP_EVENT } from "./chrome";
import { markBackButton } from "./transitions";
import { currentTab, saveScroll, scrollToRestore } from "./tabStacks";
import { historyNavSnapshot } from "@/lib/app/historyNav";

export interface IphoneScreenOptions {
  /** The large title (and the small one in the bar once it scrolls away). Defaults to the view's title. */
  title?: string;
  /** A large title at the top of the content (default), or only the small one in the bar (a note). */
  large?: boolean;
  /** A line under the large title ("Personal", "Today · Friday"). */
  subtitle?: ReactNode;
  /** Replaces the Back button (the avatar on Home, Tasks and Calendar). */
  leading?: ReactNode;
  /** The screen's actions, top right (a glass pill). */
  trailing?: ReactNode;
  /** Sits in the middle of the bar until the small title takes its place (a note's folder chip). */
  center?: ReactNode;
  /** A tab's first screen: no Back button. */
  root?: boolean;
  /** Where Back goes when there's no page to go back to (opened from a link). */
  back?: string;
  /** How far the content scrolls before the small title shows (defaults to the large title's height). */
  collapseAt?: number;
  /** The fade behind the bar once content scrolls under it: the canvas colour, or only a blur (over a note). */
  edge?: "canvas" | "clear";
  /** Content under the large title that scrolls with it (a search field, chips). */
  header?: ReactNode;
  /** The screen scrolls inside its content (a note's page) instead of as a whole. */
  innerScroll?: boolean;
  /** The grey of grouped lists behind the content (Settings). */
  grouped?: boolean;
}

/** Where Back leads without history: a note's folder is unknown here, so Home (lists) or the tab's root. */
function parentOf(route: Route): string {
  switch (route.name) {
    case "settings":
      return "/settings";
    case "folder":
    case "tag":
      return "/documents";
    case "review":
      return "/documents";
    default:
      return "/documents";
  }
}

/**
 * One screen of the iPhone app's navigation stack: a glass bar over the content (Back or the screen's own
 * leading control, the small title once the large one scrolls away, the screen's actions) and the content,
 * which scrolls under the bar and the floating tab bar. Taps on the current tab scroll it back to the top.
 */
export function IphoneScreen({ options, fallbackTitle, children, overlay, tint }: { options: IphoneScreenOptions; fallbackTitle?: string; children: ReactNode; overlay?: ReactNode; tint?: string }) {
  const { title = fallbackTitle ?? "", large = true, subtitle, leading, trailing, center, root, back, collapseAt, edge = "canvas", header, innerScroll, grouped } = options;
  const { route, canBack, back: goBackInHistory, navigate } = useAppRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname, search } = useAppRouter();
  const href = `${pathname}${search.size ? `?${search.toString()}` : ""}`;
  const hrefRef = useRef(href);
  useEffect(() => {
    hrefRef.current = href;
  }, [href]);

  // Coming back to this screen (Back, or its tab picked again) scrolls it to where it was; leaving it keeps
  // how far it was scrolled (tabStacks.ts). Its content may still be loading, so keep trying for a moment.
  const place = useRef<{ tab: ReturnType<typeof currentTab>; at: number } | null>(null);
  useEffect(() => {
    place.current = { tab: currentTab(), at: historyNavSnapshot().at };
    const target = scrollToRestore(href);
    let frame = 0;
    if (target !== null) {
      const started = performance.now();
      const step = () => {
        const scroller = innerScroll ? rootRef.current?.querySelector<HTMLElement>("[data-iphone-scroll]") : mainRef.current;
        if (scroller) {
          scroller.scrollTop = target;
          if (Math.abs(scroller.scrollTop - target) < 2) return;
        }
        if (performance.now() - started < 1200) frame = requestAnimationFrame(step);
      };
      step();
    }
    return () => cancelAnimationFrame(frame);
    // Once per screen: its address can change in place (another task view), which isn't coming back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The small title shows once the large one has scrolled under the bar; the bar's fade once anything has.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let frame = 0;
    const measure = (target: EventTarget | null) => {
      const scroller = target instanceof HTMLElement ? target : mainRef.current;
      if (!scroller || !el.contains(scroller)) return;
      // Only the screen's own scrolling counts (not a carousel scrolling sideways, not a list inside a card).
      if (scroller !== mainRef.current && !scroller.hasAttribute("data-iphone-scroll")) return;
      const top = scroller.scrollTop;
      // (Kept as it scrolls, not when the screen goes: a screen drawn again while loading has scrolled nowhere.)
      if (place.current) saveScroll(place.current.tab, place.current.at, hrefRef.current, top);
      const t = titleRef.current;
      const at = collapseAt ?? (t && mainRef.current ? t.offsetTop + t.offsetHeight - (parseFloat(getComputedStyle(mainRef.current).paddingTop) || 0) : 60);
      setCollapsed(top > Math.max(8, at));
      setScrolled(top > 2);
    };
    const onScroll = (e: Event) => {
      cancelAnimationFrame(frame);
      const target = e.target;
      frame = requestAnimationFrame(() => measure(target));
    };
    el.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const toTop = () => {
      const scroller = innerScroll ? el.querySelector<HTMLElement>("[data-iphone-scroll]") : mainRef.current;
      scroller?.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    window.addEventListener(SCROLL_TOP_EVENT, toTop);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener(SCROLL_TOP_EVENT, toTop);
    };
  }, [collapseAt, innerScroll]);

  const goBack = useCallback(() => {
    if (canBack) {
      markBackButton();
      goBackInHistory();
    } else navigate(back ?? parentOf(route), { replace: true });
  }, [canBack, goBackInHistory, navigate, back, route]);

  // A tab's first screen opened on top of others in its tab (Completed tasks from Tasks) has Back.
  const stacked = Boolean(root && canBack);
  const showBack = (!root && !leading) || stacked;
  const smallTitle = large ? collapsed : collapsed && Boolean(title);
  return (
    <div
      ref={rootRef}
      className={`relative flex min-h-0 flex-1 flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] ${tint ? "ui-view-tint" : ""} ${grouped ? "bg-[var(--iphone-grouped)]" : ""}`}
      style={tint ? ({ ["--view-tint" as string]: tint } as React.CSSProperties) : undefined}
    >
      {/* The fade behind the bar, once content scrolls under it: a soft blur that clears towards the content. */}
      <div
        aria-hidden
        data-iphone-bar-fade=""
        className={`pointer-events-none absolute inset-x-0 top-0 z-20 h-[calc(env(safe-area-inset-top)+68px)] transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`}
        style={{
          // Over a note ("clear") a lighter veil of the canvas, so the small title still reads over its text.
          background:
            edge === "canvas"
              ? `linear-gradient(to bottom, ${grouped ? "var(--iphone-grouped)" : "var(--color-canvas)"} 0%, color-mix(in oklab, ${grouped ? "var(--iphone-grouped)" : "var(--color-canvas)"} 82%, transparent) 55%, transparent 100%)`
              : "linear-gradient(to bottom, color-mix(in oklab, var(--color-canvas) 78%, transparent) 0%, color-mix(in oklab, var(--color-canvas) 45%, transparent) 60%, transparent 100%)",
          WebkitBackdropFilter: "blur(10px)",
          backdropFilter: "blur(10px)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 50%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, #000 0%, #000 50%, transparent 100%)",
        }}
      />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+4px)] pl-[calc(16px+env(safe-area-inset-left))] pr-[calc(16px+env(safe-area-inset-right))]">
        <div className="pointer-events-auto flex min-w-11 flex-1 basis-0 items-center">
          {(stacked ? null : leading) ??
            (showBack ? (
              <GlassCircle label="Back" onClick={goBack}>
                <ChevronLeft size={24} strokeWidth={2.2} aria-hidden className="-ml-0.5" />
              </GlassCircle>
            ) : null)}
        </div>
        <div className="pointer-events-auto flex h-11 min-w-0 max-w-[56%] flex-none items-center justify-center">
          {center ? <div className={`min-w-0 transition-[opacity,transform] duration-200 ${smallTitle ? "pointer-events-none -translate-y-1 opacity-0" : "opacity-100"}`}>{center}</div> : null}
        </div>
        {/* The small title, centred on the screen (not between the bar's two sides, which differ in width). */}
        <p
          aria-hidden={!smallTitle}
          className={`pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top)+4px)] flex h-11 max-w-[50%] -translate-x-1/2 items-center text-[17px] font-semibold text-heading transition-[opacity,transform] duration-200 ${smallTitle ? "opacity-100" : "translate-y-1 opacity-0"}`}
        >
          <span className="truncate">{title}</span>
        </p>
        <div className="pointer-events-auto flex min-w-11 flex-1 basis-0 items-center justify-end gap-2">{trailing}</div>
      </header>
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={`min-h-0 flex-1 outline-none ${innerScroll ? "flex flex-col overflow-hidden" : "overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+104px)] pt-[calc(env(safe-area-inset-top)+52px)]"}`}
      >
        {innerScroll ? (
          <h1 className="sr-only">{title}</h1>
        ) : large ? (
          <div className="px-5 pb-1 pt-2">
            <h1 ref={titleRef} className="ui-large-title">
              {title}
            </h1>
            {subtitle ? <div className="mt-0.5 text-[15px] text-muted">{subtitle}</div> : null}
          </div>
        ) : (
          <h1 className="sr-only">{title}</h1>
        )}
        {header}
        {children}
      </main>
      {overlay}
    </div>
  );
}
