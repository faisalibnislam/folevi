"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  CreditCard,
  History,
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
  { label: "Changelog", href: "/changelog", icon: History },
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

/** Lights the site's canvas with an image while the calling component is on screen (the home page's note). */
export function useSiteAmbient(image: string | null) {
  const set = useContext(AmbientContext);
  useEffect(() => {
    set(image);
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
      <div className="flex-none space-y-1.5 px-2.5 pb-3 pt-2">
        <a href={signInUrl} className={cx(ROW, ROW_OFF)}>
          <LogIn size={16} aria-hidden className="flex-none text-muted transition-colors group-hover:text-heading" />
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
  // The home page's note lights the canvas from the first paint; its style picker changes it from there.
  const [ambient, setAmbient] = useState<string | null>(pathname === "/" ? homeAmbient : null);
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const close = useCallback(() => setOpen(false), []);

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
      <div className="mk-root mk-shell text-ink">
        <a href="#main" className="mk-skip sr-only-focusable">
          Skip to content
        </a>
        <Ambient image={ambient} />

        <div className="lg:flex lg:gap-2 lg:p-2">
          <header className="mk-sidebar hidden lg:block">
            <SiteNav signInUrl={signInUrl} signUpUrl={signUpUrl} />
          </header>

          <div className="min-w-0 flex-1" inert={open}>
            <header className="mk-rail sticky top-0 z-50 lg:hidden" data-scrolled={scrolled}>
              <div className="flex h-16 items-center gap-2 px-4 sm:px-8">
                <Link href="/" className="-ml-1.5 flex h-11 items-center rounded-[6px] px-1.5 text-heading" aria-label="Folevi home">
                  <FoleviLogo height={24} title={null} />
                </Link>
                <span className="flex-1" />
                <a href={signUpUrl} className="mk-btn mk-btn-primary h-9 px-3.5 text-[14px]">
                  Start writing
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

            <div className="mk-content">
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
