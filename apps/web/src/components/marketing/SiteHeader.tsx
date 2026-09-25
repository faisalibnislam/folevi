"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FoleviWordmark } from "@/components/brand/FoleviMark";
import { Icon } from "./icons";
import { cx } from "./ui";

type NavItem = { label: string; href: string };

export function SiteHeader({ nav, signInUrl, signUpUrl }: { nav: readonly NavItem[]; signInUrl: string; signUpUrl: string }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheetRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    const media = window.matchMedia("(min-width: 768px)");
    const onMedia = () => media.matches && close(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    media.addEventListener("change", onMedia);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      media.removeEventListener("change", onMedia);
    };
  }, [open, close]);

  const isCurrent = (href: string) => !href.includes("#") && (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="mk-rail sticky top-0 z-50" data-scrolled={scrolled} data-open={open}>
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="-ml-1 flex h-11 items-center rounded-control px-1 text-ink" aria-label="Folevi home">
          <FoleviWordmark markSize={22} className="text-[17px]" />
        </Link>

        <nav aria-label="Primary" className="ml-2 hidden md:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(item.href) ? "page" : undefined}
                  className="mk-navlink inline-flex h-9 items-center rounded-control px-2.5 text-[14px] font-medium text-muted transition-colors duration-150 hover:text-ink aria-[current=page]:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <a href={signInUrl} className="inline-flex h-9 items-center rounded-control px-3 text-[14px] font-medium text-muted transition-colors duration-150 hover:text-ink">
            Sign in
          </a>
          <a href={signUpUrl} className="mk-btn mk-btn-primary h-9 px-3.5 text-[14px]">
            Start writing
          </a>
        </div>

        <button
          ref={buttonRef}
          type="button"
          className="ml-auto inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-control px-2.5 text-[14px] font-medium text-ink md:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{open ? "Close" : "Menu"}</span>
          <Icon name={open ? "close" : "menu"} size={18} />
        </button>
      </div>

      <div
        ref={sheetRef}
        id={menuId}
        hidden={!open}
        className={cx("mk-sheet absolute inset-x-0 top-full md:hidden")}
      >
        <nav aria-label="Primary" className="mx-auto w-full max-w-[1200px] px-5 pb-5 pt-2 sm:px-8">
          <ul className="divide-y divide-line border-b mk-hair">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(item.href) ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center justify-between text-[17px] text-ink"
                >
                  {item.label}
                  <Icon name="chevron-right" size={16} className="text-faint" />
                </Link>
              </li>
            ))}
            <li>
              <a href={signInUrl} className="flex h-12 items-center text-[17px] text-ink">
                Sign in
              </a>
            </li>
          </ul>
          <a href={signUpUrl} className="mk-btn mk-btn-primary mt-4 h-11 w-full text-[15px]">
            Start writing
          </a>
        </nav>
      </div>
    </header>
  );
}
