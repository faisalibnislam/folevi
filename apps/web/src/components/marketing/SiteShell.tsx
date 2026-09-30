"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ArrowUp,
  BookOpen,
  FileText,
  CreditCard,
  House,
  LayoutGrid,
  LayoutTemplate,
  LifeBuoy,
  LogIn,
  Menu,
  Monitor,
  Newspaper,
  Scale,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { FeatureGlyph } from "./features/FeatureIcon";
import { Icon } from "./icons";
import { cx } from "./ui";

/*
 * The marketing site's frame, built like the app's (components/app/Shell.tsx and Sidebar.tsx): a sidebar
 * sitting flat on the soft canvas, and the page in one rounded content panel beside it. Below 1024 px a
 * compact bar takes the sidebar's place and opens it as a drawer, as the app does on narrow screens.
 */

type Row = { label: string; href: string; icon: LucideIcon };

const ROWS: Row[] = [
  { label: "Home", href: "/", icon: House },
  { label: "Features", href: "/features", icon: LayoutGrid },
  { label: "Template gallery", href: "/template-gallery", icon: LayoutTemplate },
  { label: "Pricing", href: "/pricing", icon: CreditCard },
  { label: "Mac app", href: "/mac", icon: Monitor },
  { label: "Docs", href: "/docs", icon: BookOpen },
  { label: "Blog", href: "/blog", icon: Newspaper },
  { label: "Compare", href: "/compare", icon: Scale },
  { label: "Security", href: "/security", icon: ShieldCheck },
  { label: "Support", href: "/support", icon: LifeBuoy },
];

/** A few feature pages, listed under a small caps label like the app's Folders section. */
const FEATURES = [
  { label: "AI Assistant", slug: "ai-notes" },
  { label: "Offline and sync", slug: "offline-notes" },
  { label: "Folders", slug: "folders" },
  { label: "Note styles", slug: "note-styles" },
].map((f) => ({ ...f, href: `/features/${f.slug}` }));

/** The row for the current page: the most specific one whose path contains it (so /docs/x marks Docs). */
function currentHref(pathname: string): string | null {
  const all = [...ROWS.map((r) => r.href), ...FEATURES.map((f) => f.href)];
  const hits = all.filter((href) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)));
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

// The app's sidebar row (components/app/Sidebar.tsx NavItem): the open page comes forward on light glass.
const ROW =
  "group flex h-8 items-center gap-2.5 whitespace-nowrap rounded-[6px] px-2.5 text-[13.5px] outline-none transition-[background-color,box-shadow,color] duration-150 focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11";
const ROW_ON = "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)]";
const ROW_OFF = "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading";

/* Ambient light ------------------------------------------------------------------------------------ */

/** The artwork that lights the canvas behind the chrome (a small image; it is drawn heavily blurred). */
const AmbientContext = createContext<(image: string | null) => void>(() => undefined);

/** The image lighting the canvas right now (the home page's backdrop follows it). */
const AmbientImageContext = createContext<string | null>(null);
export const useSiteAmbientImage = () => useContext(AmbientImageContext);

/** Lights the site's canvas with an image while the calling component is on screen (a page's artwork). */
export function useSiteAmbient(image: string | null) {
  const set = useContext(AmbientContext);
  useEffect(() => {
    if (image) set(image);
  }, [image, set]);
  useEffect(() => () => set(null), [set]);
}

/* The sidebar ------------------------------------------------------------------------------------ */

function SiteNav({ signInUrl, signUpUrl, onNavigate, onClose }: { signInUrl: string; signUpUrl: string; onNavigate?: () => void; onClose?: () => void }) {
  const pathname = usePathname() ?? "/";
  const featuresId = useId();
  const current = currentHref(pathname);
  const row = (href: string) => ({ "aria-current": href === current ? ("page" as const) : undefined, className: cx(ROW, href === current ? ROW_ON : ROW_OFF) });
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] flex-none items-center gap-1 px-3">
        <Link href="/" onClick={onNavigate} aria-label="Folevi home" className="flex min-w-0 flex-1 items-center rounded-[6px] px-1 py-1 text-heading outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <FoleviLogo height={26} title={null} className="flex-none" />
        </Link>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close menu" className="grid size-11 flex-none place-items-center rounded-[6px] text-muted outline-none transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus">
            <X size={18} aria-hidden />
          </button>
        ) : null}
      </div>

      <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        <ul className="mt-2 space-y-0.5">
          {ROWS.map(({ label, href, icon: RowIcon }) => (
            <li key={href}>
              <Link href={href} onClick={onNavigate} {...row(href)}>
                <RowIcon size={16} aria-hidden className={cx("flex-none transition-colors", href === current ? "text-heading" : "text-muted group-hover:text-heading")} />
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <p id={featuresId} className="ui-caps mt-5 flex h-7 items-center px-2.5 text-ink/80">
          Features
        </p>
        <ul aria-labelledby={featuresId} className="mt-1 space-y-0.5">
          {FEATURES.map(({ label, href, slug }) => (
            <li key={href}>
              <Link href={href} onClick={onNavigate} {...row(href)}>
                <FeatureGlyph slug={slug} size={16} className={cx("flex-none transition-colors", href === current ? "text-heading" : "text-muted group-hover:text-heading")} />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Where the app shows the account: signing in, and the way in for new people. */}
      <div className="flex-none space-y-2 px-2.5 pb-3 pt-2">
        <a href={signInUrl} className="mk-btn mk-btn-secondary h-10 w-full text-[14px]">
          <LogIn size={15} aria-hidden className="flex-none" />
          Sign in
        </a>
        <a href={signUpUrl} className="mk-btn mk-btn-primary h-10 w-full text-[14px]">
          Start writing
          <Icon name="arrow-right" size={15} />
        </a>
      </div>
    </div>
  );
}

/* The tab bar (1024 px and up) ------------------------------------------------------------------ */

/** The section a page sits under (its sidebar row), for the Up button and the section tab. */
function sectionOf(pathname: string): Row | null {
  if (pathname === "/") return null;
  const first = `/${pathname.split("/")[1]}`;
  return ROWS.find((r) => r.href === first) ?? null;
}

/** A tab's name before the page's <title> is known (server render): the sidebar row, else the path's last part. */
function fallbackTitle(href: string): string {
  const row = ROWS.find((r) => r.href === href);
  if (row) return row.label;
  const last = decodeURIComponent(href.split("/").filter(Boolean).pop() ?? "");
  return last ? last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ") : "Page";
}

/** The open page's short name: its <title> without the site's suffix ("Note folders: organize…" is "Note folders"). */
const titleNow = () => document.title.replace(/\s+·\s+Folevi$/, "").replace(/^Folevi:\s*/, "").split(": ")[0]!.trim();

type SiteTab = { href: string; title: string };
const TABS_KEY = "folevi:site-tabs";
/** Tabs besides Home; past this, the oldest one that isn't open drops off. */
const MAX_TABS = 8;

function readTabs(): SiteTab[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TABS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is SiteTab => typeof t?.href === "string" && typeof t?.title === "string" && t.href.startsWith("/") && t.href !== "/").slice(-MAX_TABS);
  } catch {
    return [];
  }
}
function writeTabs(tabs: SiteTab[]) {
  try {
    sessionStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    // Storage can be off (private windows); the tabs then last for this page view only.
  }
}

/** Adds the open page as a tab (once), keeping at most MAX_TABS by dropping the oldest other tab. */
function withTab(tabs: SiteTab[], href: string, pageTitle: string): SiteTab[] {
  if (href === "/") return tabs;
  // A sidebar page's tab uses the sidebar's name for it (Docs, Pricing); others use the page's title.
  const title = ROWS.find((r) => r.href === href)?.label ?? pageTitle;
  const existing = tabs.find((t) => t.href === href);
  if (existing) return !title || existing.title === title ? tabs : tabs.map((t) => (t.href === href ? { ...t, title } : t));
  const next = [...tabs, { href, title: title || fallbackTitle(href) }];
  while (next.length > MAX_TABS) next.splice(next.findIndex((t) => t.href !== href), 1);
  return next;
}

/**
 * The open tabs, kept as the app keeps them: every page opened becomes a tab and stays while you browse (for
 * this browsing session). The server renders the open page's tab alone; the others come back after hydration.
 */
function useSiteTabs(pathname: string) {
  const [tabs, setTabs] = useState<SiteTab[]>(() => (pathname === "/" ? [] : [{ href: pathname, title: fallbackTitle(pathname) }]));
  const loaded = useRef(false);
  useEffect(() => {
    // Restore the session's tabs once, then add (or rename) the open page's tab with its real title.
    const saved = loaded.current ? null : readTabs();
    loaded.current = true;
    setTabs((current) => withTab(saved ?? current, pathname, titleNow()));
    const head = document.querySelector("head");
    if (!head) return;
    // A later title change renames the tab; it never adds one (a closed tab stays closed while Next leaves).
    const observer = new MutationObserver(() =>
      setTabs((current) => (current.some((t) => t.href === location.pathname) ? withTab(current, location.pathname, titleNow()) : current)),
    );
    observer.observe(head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname]);
  useEffect(() => {
    if (loaded.current) writeTabs(tabs);
  }, [tabs]);
  return [tabs, setTabs] as const;
}

// The app's tab strip tabs (components/app/TabStrip.tsx): the open one comes forward, the others sit back.
const TAB =
  "group relative flex h-8 min-w-0 items-center gap-2 rounded-[6px] px-2.5 text-[13px] outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-focus has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus";
const TAB_ON = "bg-[var(--color-surface-raised)] font-semibold text-heading shadow-[0_1px_3px_rgb(0_0_0/0.1),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_16.5%,transparent)]";
// Quiet tabs use a slightly stronger text than the app's muted grey: on Home they sit over the note's artwork.
const TAB_OFF = "bg-[var(--glass-hover)] text-ink/65 hover:bg-[color-mix(in_oklab,var(--glass-active)_70%,transparent)] hover:text-heading";
const ICON_BTN =
  "grid size-8 flex-none place-items-center rounded-[6px] text-muted outline-none transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus";

/**
 * The bar over the page panel, as the app's tab strip draws it: Up (to the page's section), then the tabs
 * (Home, pinned, and every page opened since, the open one forward), and Sign up where the app has New note.
 * Closing the open tab goes to the tab on its left.
 */
function TabBar({ signUpUrl }: { signUpUrl: string }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [tabs, setTabs] = useSiteTabs(pathname);
  const onHome = pathname === "/";
  const section = sectionOf(pathname);
  const up = onHome ? null : pathname.split("/").slice(0, -1).join("/") || "/";
  const upLabel = up === "/" ? "Home" : (section?.label ?? "the section above");

  // Keep the open tab in view, and fade the edges that have more tabs past them (as TabStrip does).
  const navRef = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const cur = el.querySelector<HTMLElement>('[aria-current="page"]')?.closest<HTMLElement>("[data-tab]");
    if (cur) {
      const left = cur.offsetLeft - el.offsetLeft;
      if (left < el.scrollLeft) el.scrollLeft = left - 8;
      else if (left + cur.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = left + cur.offsetWidth - el.clientWidth + 8;
    }
    const update = () => setOverflow({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [pathname, tabs.length]);
  const fade = 28;
  const mask = `linear-gradient(to right, ${overflow.start ? "transparent" : "#000"} 0, #000 ${fade}px, #000 calc(100% - ${fade}px), ${overflow.end ? "transparent" : "#000"} 100%)`;

  const closeTab = (href: string) => {
    const i = tabs.findIndex((t) => t.href === href);
    const next = tabs.filter((t) => t.href !== href);
    setTabs(next);
    if (href === pathname) router.push(next[i - 1]?.href ?? "/");
  };

  return (
    <div className="mk-app-glass flex h-11 flex-none items-center gap-1.5 rounded-[12px] px-1.5">
      {up ? (
        <Link href={up} aria-label={`Up to ${upLabel}`} title={`Up to ${upLabel}`} className={ICON_BTN}>
          <ArrowUp size={15} aria-hidden />
        </Link>
      ) : (
        <span aria-hidden="true" className={cx(ICON_BTN, "pointer-events-none opacity-30")}>
          <ArrowUp size={15} />
        </span>
      )}
      <span aria-hidden="true" className="h-5 w-px flex-none bg-[var(--glass-border)]" />
      <nav
        ref={navRef}
        aria-label="Open pages"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="flex min-w-0 flex-initial items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Link href="/" data-tab="" aria-current={onHome ? "page" : undefined} className={cx(TAB, "flex-none", onHome ? TAB_ON : TAB_OFF)}>
          <House size={14} aria-hidden className="flex-none" />
          Home
        </Link>
        {tabs.map((tab) => {
          const active = tab.href === pathname;
          const TabIcon = ROWS.find((r) => r.href === tab.href)?.icon ?? FileText;
          return (
            <span key={tab.href} data-tab="" className={cx(TAB, "min-w-[132px] flex-[0_1_220px] pr-1", active ? TAB_ON : TAB_OFF)}>
              <Link href={tab.href} aria-current={active ? "page" : undefined} title={tab.title} className="flex min-w-0 flex-1 items-center gap-2 outline-none">
                <TabIcon size={14} aria-hidden className="flex-none opacity-70" />
                <span className="truncate">{tab.title}</span>
              </Link>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={() => closeTab(tab.href)}
                className={cx(
                  "grid size-5 flex-none place-items-center rounded-[4px] text-faint outline-none transition-opacity hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          );
        })}
      </nav>
      <span className="flex-1" />
      <a href={signUpUrl} className="mk-btn mk-btn-primary h-8 flex-none gap-1.5 px-3 text-[13px]">
        Sign up
      </a>
    </div>
  );
}

/**
 * From 1024 px the page scrolls inside its panel, as the app's content does, not in the window: each new
 * page starts at the top, Back and Forward return to where you were, and a link to #anchor scrolls to it.
 */
function usePanelScroll(panel: RefObject<HTMLDivElement | null>, pathname: string) {
  const positions = useRef(new Map<string, number>());
  const popped = useRef(false);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onPop = () => {
      popped.current = true;
    };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => positions.current.set(location.pathname + location.search, el.scrollTop));
    };
    window.addEventListener("popstate", onPop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("popstate", onPop);
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [panel]);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !window.matchMedia("(min-width: 1024px)").matches) return;
    if (popped.current) {
      popped.current = false;
      el.scrollTop = positions.current.get(location.pathname + location.search) ?? 0;
      return;
    }
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else el.scrollTop = 0;
  }, [panel, pathname]);
}

/* The drawer (narrow screens) --------------------------------------------------------------------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);

/**
 * The navigation as a modal drawer (components/app/Shell.tsx NavDrawer): focus moves in on open and stays
 * inside, Escape or the scrim closes it, the page behind can't scroll, and focus returns to the menu button.
 */
function Drawer({ id, onClose, children }: { id: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    (focusables(root)[0] ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(root);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      html.style.overflow = overflow;
      // The page behind was inert until this commit; focus the menu button once it can take focus again.
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-drawer-toggle]")?.focus({ preventScroll: true }));
    };
  }, []);
  return (
    <div ref={ref} id={id} role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1} className="fixed inset-0 z-[60] flex outline-none lg:hidden">
      <div className="ui-pop mk-drawer h-full w-[min(86vw,320px)] rounded-none">{children}</div>
      <button type="button" tabIndex={-1} aria-label="Close menu" className="flex-1 bg-[var(--color-scrim)] backdrop-blur-[2px]" onClick={onClose} />
    </div>
  );
}

/* The frame ------------------------------------------------------------------------------------- */

export function SiteShell({ signInUrl, signUpUrl, homeAmbient, footer, children }: { signInUrl: string; signUpUrl: string; homeAmbient: string; footer: ReactNode; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  // Every page is lit by an artwork: the site's default (the home note's first style) unless the page sets
  // its own; the home page's style picker changes it from there.
  const [pageAmbient, setAmbient] = useState<string | null>(null);
  const ambient = pageAmbient ?? homeAmbient;
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const close = useCallback(() => setOpen(false), []);
  const panel = useRef<HTMLDivElement>(null);
  usePanelScroll(panel, pathname);

  // A new page closes the drawer, and so does widening the window past the drawer's range.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }
  // The top bar (narrow screens) gets its hairline once the page has scrolled under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => wide.matches && setOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  return (
    <AmbientContext.Provider value={setAmbient}>
      <AmbientImageContext.Provider value={ambient}>
        <div className="mk-root mk-shell text-ink">
          <a href="#main" className="mk-skip sr-only-focusable">
            Skip to content
          </a>
          <Ambient image={ambient} />

          <div className="mk-frame">
            <header className="mk-sidebar hidden lg:block">
              <SiteNav signInUrl={signInUrl} signUpUrl={signUpUrl} />
            </header>

            <div className="mk-column" inert={open}>
              <div className="hidden lg:block">
                <TabBar signUpUrl={signUpUrl} />
              </div>
              <header className="mk-rail sticky top-0 z-50 lg:hidden" data-scrolled={scrolled}>
                <div className="flex h-16 items-center gap-2 px-4 sm:px-8">
                  <Link href="/" className="-ml-1.5 flex h-11 items-center rounded-[6px] px-1.5 text-heading" aria-label="Folevi home">
                    <FoleviLogo height={24} title={null} />
                  </Link>
                  <span className="flex-1" />
                  <a href={signUpUrl} className="mk-btn mk-btn-primary h-9 px-3.5 text-[14px]">
                    Sign up
                  </a>
                  <button
                    type="button"
                    aria-label="Menu"
                    aria-expanded={open}
                    aria-controls={drawerId}
                    aria-haspopup="dialog"
                    data-drawer-toggle=""
                    onClick={() => setOpen(true)}
                    className="mk-btn mk-btn-secondary size-11 flex-none px-0"
                  >
                    <Menu size={18} aria-hidden />
                  </button>
                </div>
              </header>

              <div ref={panel} className="mk-content">
                <main id="main" tabIndex={-1} className="outline-none">
                  {children}
                </main>
                {footer}
              </div>
            </div>
          </div>

          {open ? (
            <Drawer id={drawerId} onClose={close}>
              <SiteNav signInUrl={signInUrl} signUpUrl={signUpUrl} onNavigate={close} onClose={close} />
            </Drawer>
          ) : null}
        </div>
      </AmbientImageContext.Provider>
    </AmbientContext.Provider>
  );
}

/** The canvas's light: the image, heavily blurred under a veil; a new image fades in over the last one. */
function Ambient({ image }: { image: string | null }) {
  const [layers, setLayers] = useState<string[]>(image ? [image] : []);
  const [shown, setShown] = useState(image);
  if (shown !== image) {
    setShown(image);
    if (image) setLayers((current) => [...current.filter((l) => l !== image).slice(-1), image]);
  }
  return (
    <div aria-hidden="true" className="mk-ambient" data-on={image ? "true" : undefined}>
      {layers.map((layer) => (
        <div key={layer} className="mk-ambient-layer" style={{ backgroundImage: `url("${layer}")` }} />
      ))}
    </div>
  );
}
