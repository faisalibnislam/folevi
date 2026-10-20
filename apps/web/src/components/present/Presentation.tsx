"use client";

// Presenting a note as slides, full screen (⌘⌥P, "Present" in the note's … menu and Info > Actions, and the
// Present button on shared pages). Where slides start: packages/editor-schema/src/slides.ts. Each slide is a
// 16:9 sheet in the note's own theme and fonts, scaled to fit the screen (and its content scaled down to fit
// the slide), with every block read-only (visual blocks as their pictures, tabs switchable). Arrow keys,
// Space, Page Up/Down, Home/End, a click or a swipe move; Esc leaves. In the browser and the Mac app the
// presentation asks for full screen (the Mac app allows it for this); where that's refused it fills the
// window, keeping clear of the Mac's window buttons. On iPhone and iPad it fills the screen inside the safe
// areas and suggests turning a phone sideways.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { flattenTree, splitSlides, type DocumentCover, type DocumentStyle, type WireBlock } from "@folevi/editor-schema";
import { ReadOnlyBlocks } from "@/components/doc/ReadOnlyBlocks";
import type { ReadOnlyCollectionData } from "@/components/views/ReadOnlyCollection";
import { coverArtOf, sheetProps, type StyleColors } from "@/lib/cover";
import { themeFontVars } from "@/lib/themes";
import { haptic } from "@/lib/nativeApp";
import "@/components/editor/editor.css";
import "@/components/editor/canvas/canvas.css";
import "./present.css";

/** The slide's own size; it's drawn scaled to the screen. */
const SLIDE_W = 1280;
const SLIDE_H = 720;

export interface PresentationProps {
  title: string;
  blocks: readonly WireBlock[];
  style: DocumentStyle;
  cover: DocumentCover;
  /** Page and text colours picked from the person's own cover image (Auto), when it has them. */
  coverPalette?: StyleColors | null;
  fileUrls: Record<string, string>;
  collections?: Record<string, ReadOnlyCollectionData>;
  /** The slide to start on. */
  start?: number;
  onClose: () => void;
}

/** Interactive things inside a slide: a click on them doesn't move to the next slide. */
const INTERACTIVE = "a, button, summary, input, textarea, select, iframe, audio, video, [role=tab], [role=tablist], [contenteditable=true]";

export function Presentation({ title, blocks, style, cover, coverPalette, fileUrls, collections, start = 0, onClose }: PresentationProps) {
  const slides = useMemo(() => {
    const split = splitSlides(flattenTree(blocks)).slides;
    return split.length ? split : [[]];
  }, [blocks]);
  const [index, setIndex] = useState(() => Math.max(0, Math.min(start, slides.length - 1)));
  const at = Math.min(index, slides.length - 1);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(1);
  const [idle, setIdle] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const fullscreen = useRef(false);

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(slides.length - 1, to));
      setIndex((cur) => {
        if (cur !== next) haptic("light");
        return next;
      });
    },
    [slides.length],
  );

  const close = useCallback(() => {
    if (fullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose();
  }, [onClose]);

  // Full screen where it's allowed (the browser, the Mac app); leaving full screen (Esc there) ends it.
  useEffect(() => {
    const root = rootRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root?.focus({ preventScroll: true });
    if (root?.requestFullscreen && !document.fullscreenElement) {
      root
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          fullscreen.current = true;
        })
        .catch(() => undefined);
    }
    const onChange = () => {
      if (fullscreen.current && !document.fullscreenElement) {
        fullscreen.current = false;
        onClose();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    // The page behind doesn't scroll while presenting.
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.documentElement.style.overflow = overflow;
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => undefined);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [onClose]);

  // The slide scaled to the screen, inside the safe areas.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      setScale(Math.max(0.1, Math.min(r.width / SLIDE_W, r.height / SLIDE_H)));
      setPortrait(window.innerHeight > window.innerWidth && window.innerWidth < 600);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // A slide with more than fits is drawn smaller, never cut off.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const room = content.parentElement?.clientHeight ?? SLIDE_H;
      const needed = content.scrollHeight;
      setFit(needed > room ? Math.max(0.3, room / needed) : 1);
    };
    setFit(1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    // Pictures and diagrams arriving late change the height too.
    const t = window.setTimeout(measure, 400);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [at]);

  // The controls step back while nothing moves.
  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2500);
    };
    wake();
    window.addEventListener("pointermove", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.clearTimeout(timer);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    // Keys for a focused tab strip or field inside the slide stay theirs.
    if (target.closest?.("[role=tablist], input, textarea")) {
      if (e.key === "Escape") close();
      return;
    }
    // Nothing typed reaches the note behind.
    e.stopPropagation();
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case "Enter":
        e.preventDefault();
        go(at + 1);
        break;
      case " ":
        e.preventDefault();
        go(e.shiftKey ? at - 1 : at + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
      case "Backspace":
        e.preventDefault();
        go(at - 1);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(slides.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  };

  // Keys anywhere while presenting, and focus kept inside it (the note behind never gets them).
  const keys = useRef(onKeyDown);
  keys.current = onKeyDown;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    const onFocus = (e: FocusEvent) => {
      const root = rootRef.current;
      const target = e.target as Node | null;
      // Menus opened from inside the slides live elsewhere in the page (the top layer): leave those alone.
      if (root && target && !root.contains(target) && !(target instanceof Element && target.closest("[role=menu]"))) root.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
    };
  }, []);

  // A swipe moves (a finger that mostly moves sideways); a tap is a click.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const swiped = useRef(false);
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    if (!p || e.touches.length > 1) return;
    touch.current = { x: p.clientX, y: p.clientY, t: Date.now() };
    swiped.current = false;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    const p = e.changedTouches[0];
    touch.current = null;
    if (!s || !p) return;
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.t < 800) {
      swiped.current = true;
      go(dx < 0 ? at + 1 : at - 1);
    }
  };
  const onStageClick = (e: React.MouseEvent) => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    if ((e.target as Element).closest?.(INTERACTIVE)) return;
    go(at + 1);
  };

  const art = coverArtOf(cover);
  const sheet = sheetProps(style, cover, coverPalette);
  const accent = style.accent === "accent" ? "ember" : style.accent;
  const slide = slides[at] ?? [];

  const body = (
    <div
      ref={rootRef}
      className={`fb-present ${idle ? "is-idle" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Presenting ${title || "Untitled"}`}
      tabIndex={-1}
      data-mac-app={typeof window !== "undefined" && window.foleviDesktop ? "" : undefined}
    >
      <div ref={stageRef} className="fb-present-stage" onClick={onStageClick} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="fb-present-frame" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
          <article
            className="fb-page fb-sheet fb-slide"
            data-font={style.font}
            data-background={style.background}
            {...sheet}
            data-separator={style.separator}
            aria-roledescription="slide"
            aria-label={`Slide ${at + 1} of ${slides.length}`}
            style={{
              ...sheet.style,
              ...themeFontVars(art?.fonts),
              ["--doc-accent" as string]: `var(--color-${accent})`,
              ["--doc-accent-ink" as string]: `var(--color-${accent}-ink)`,
              ["--doc-accent-soft" as string]: `var(--color-${accent}-soft)`,
              width: SLIDE_W,
              height: SLIDE_H,
              transform: `scale(${scale})`,
            }}
          >
            <div className="fb-slide-body">
              <div
                ref={contentRef}
                className="fb-slide-content"
                style={fit < 1 ? { transform: `scale(${fit})`, width: `${100 / fit}%` } : undefined}
              >
                {at === 0 && title ? <h1 className="fb-slide-title">{title}</h1> : null}
                <ReadOnlyBlocks key={at} blocks={[]} entries={slide} fileUrls={fileUrls} collections={collections} />
              </div>
            </div>
          </article>
        </div>
      </div>
      {portrait ? <p className="fb-present-hint">Turn your phone sideways for bigger slides.</p> : null}
      <div className="fb-present-bar" role="toolbar" aria-label="Presentation">
        <button type="button" className="fb-present-btn" aria-label="Previous slide" disabled={at === 0} onClick={() => go(at - 1)}>
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span className="fb-present-count" aria-live="polite" aria-atomic="true">
          {at + 1} / {slides.length}
        </span>
        <button type="button" className="fb-present-btn" aria-label="Next slide" disabled={at >= slides.length - 1} onClick={() => go(at + 1)}>
          <ChevronRight size={18} aria-hidden />
        </button>
        <span className="fb-present-sep" aria-hidden />
        <button type="button" className="fb-present-btn fb-present-exit" onClick={close} aria-label="Stop presenting" title="Stop presenting (Esc)">
          <X size={16} aria-hidden />
          <span>Exit</span>
        </button>
      </div>
    </div>
  );
  // Only ever drawn in the browser (it opens on a click or a key), so the page's body is there.
  return createPortal(body, document.body);
}
