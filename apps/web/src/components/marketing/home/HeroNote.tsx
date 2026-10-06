"use client";

import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { preload } from "react-dom";
import { paletteVars, type CoverArt } from "@/lib/cover";
import { artVars } from "../product/Replica";
import { useSiteAmbient } from "../SiteShell";
import { cx } from "../ui";
import type { HeroEditorProps } from "./HeroEditor";
import { HERO_PHONE_MEDIA, HERO_STYLES, heroBand as band, heroBandSet as bandSet, heroGlow as glow, heroPhone as phone } from "./heroStyles";

/** The editable note loads after the page has painted (on idle, or at once when the visitor reaches for it). */
let editorModule: Promise<ComponentType<HeroEditorProps>> | null = null;
const loadEditor = () => (editorModule ??= import("./HeroEditor").then((m) => m.default));

/**
 * The cover band is the sheet's width, which is the home cards' width: the content panel (beside the 248 px
 * sidebar and its 8 px gaps from 1024 px) less the page gutters, 1136 px at most.
 */
const BAND_SIZES = "(min-width: 1472px) 1136px, (min-width: 1024px) calc(100vw - 336px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 32px)";

type Layer = { key: number; art: CoverArt };

/**
 * The home page hero, drawn as a Folevi note: the style's artwork lights the page behind it (blurred, as with
 * the app's Blur background), the sheet takes the style's paper and ink, and the title sits on the cover as
 * the app puts it (white on covers that read deep, the style's ink on light ones). Picking a style cross-fades
 * all of it, as changing a note's style does in the app. `children` is the note's body (its blocks); `actions`
 * sit in their own card under the note, beside the style picker.
 */
export function HeroNote({ title, chip, children, actions }: { title: ReactNode; chip: ReactNode; children: ReactNode; actions: ReactNode }) {
  const [index, setIndex] = useState(0);
  // The artwork shown, newest last: a new style fades in over the one before it once its image has loaded.
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, art: HERO_STYLES[0]! }]);
  const nextKey = useRef(1);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const art = HERO_STYLES[index]!;
  // The note's style lights the site's chrome too, as a note's style lights the app's glass.
  useSiteAmbient(glow(art));

  // The first style's cover is the largest thing above the fold: fetch it early, at the size it shows, and
  // only the one the screen will use (the phone crop below 640 px, the band above).
  preload(phone(HERO_STYLES[0]!), { as: "image", fetchPriority: "high", media: HERO_PHONE_MEDIA });
  preload(band(HERO_STYLES[0]!), { as: "image", imageSrcSet: bandSet(HERO_STYLES[0]!), imageSizes: BAND_SIZES, fetchPriority: "high", media: "(min-width: 640px)" });

  // The style's colours also tint the rest of the home page (the section pictures and wells, via .mk-home).
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const home = stageRef.current?.closest<HTMLElement>(".mk-home");
    if (!home) return;
    for (const [name, value] of Object.entries({ ...artVars(art), ...paletteVars(art) })) home.style.setProperty(name, String(value));
  }, [art]);

  // The live editor replaces the static body once it has loaded (same layout, so nothing moves).
  const [Live, setLive] = useState<ComponentType<HeroEditorProps> | null>(null);
  const [dockSlot, setDockSlot] = useState<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const noteRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const savedId = useId();
  useEffect(() => {
    let cancelled = false;
    const start = () => void loadEditor().then((C) => !cancelled && setLive(() => C));
    const note = noteRef.current;
    note?.addEventListener("pointerenter", start, { once: true });
    note?.addEventListener("focusin", start, { once: true });
    note?.addEventListener("touchstart", start, { once: true, passive: true });
    // Without a hand on the note, it loads once the page is idle, except with Data Saver on or on 2G, where
    // only reaching for the note does: the editor is a few hundred KB. (Browsers' 3G estimate is too rough
    // to act on: it shows up on fast connections too.)
    const w = window as Window & { requestIdleCallback?: Window["requestIdleCallback"] };
    const net = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const frugal = Boolean(net?.saveData) || /2g$/.test(net?.effectiveType ?? "");
    const idle = !frugal && w.requestIdleCallback ? w.requestIdleCallback(start, { timeout: 4000 }) : null;
    const timer = !frugal && idle === null ? setTimeout(start, 2500) : null;
    return () => {
      cancelled = true;
      note?.removeEventListener("pointerenter", start);
      note?.removeEventListener("focusin", start);
      note?.removeEventListener("touchstart", start);
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  const onReady = useCallback((ed: Editor) => setEditor(ed), []);

  const pick = (next: number) => {
    if (next === index) return;
    setIndex(next);
    setLayers((current) => [...current, { key: nextKey.current++, art: HERO_STYLES[next]! }]);
  };
  // Once a cover has faded in, the artwork under it is hidden: let it go.
  const shown = (key: number) => {
    window.setTimeout(() => setLayers((current) => current.slice(Math.max(0, current.findIndex((layer) => layer.key === key)))), 700);
  };

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const jump = event.key === "Home" ? 0 : event.key === "End" ? HERO_STYLES.length - 1 : null;
    if (!step && jump === null) return;
    event.preventDefault();
    const next = jump ?? (index + step + HERO_STYLES.length) % HERO_STYLES.length;
    pick(next);
    refs.current[next]?.focus();
  };

  return (
    <div ref={stageRef} className="mk-hero-stage" style={{ ...artVars(art), ...paletteVars(art) }} data-tone={art.tone}>
      <div className="relative mx-auto w-full max-w-[1200px] px-4 pb-3 pt-4 sm:px-8 sm:pb-5 sm:pt-8">
        <article ref={noteRef} className="mk-note mk-hero-note">
          <header className="mk-hero-cover">
            <div aria-hidden="true" className="mk-hero-art">
              {layers.map((layer) => (
                <FadeImage
                  key={layer.key}
                  src={band(layer.art)}
                  srcSet={bandSet(layer.art)}
                  sizes={BAND_SIZES}
                  phoneSrc={phone(layer.art)}
                  first={layer.key === 0}
                  priority={layer.key === 0}
                  onShown={() => shown(layer.key)}
                />
              ))}
              <span className="mk-hero-grain" data-grain="deep" />
              <span className="mk-hero-grain" data-grain="light" />
              <span className="mk-hero-shade" data-shade="deep" />
              <span className="mk-hero-shade" data-shade="light" />
            </div>
            {/* The page's h1. With the editor loaded it can be edited too, like a note's title (Enter goes to the text). */}
            <h1
              ref={titleRef}
              id="hero-title"
              className="mk-hero-title"
              contentEditable={editor ? "plaintext-only" : undefined}
              suppressContentEditableWarning
              spellCheck={editor ? false : undefined}
              aria-describedby={editor ? savedId : undefined}
              onKeyDown={
                editor
                  ? (e) => {
                      if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
                        e.preventDefault();
                        editor.chain().focus("start").run();
                      }
                    }
                  : undefined
              }
            >
              {title}
            </h1>
          </header>

          <div className="mk-hero-body">
            <div className="mk-hero-meta">
              <p className="mk-hero-badge">{chip}</p>
              <p className="mk-hero-try">Try it: this note is yours until you refresh.</p>
            </div>
            <p id={savedId} className="sr-only">
              This note is a live demo of the editor. Changes aren’t saved; reloading the page brings the original note back.
            </p>
            {/* The body as the editor draws it: the note's font and the style's page, text and accent colours. */}
            <div className="fb-page mk-hero-page" data-font="serif">
              <div className="fb-sheet mk-hero-sheet relative" data-sheet="art" data-text="art" data-palette="">
                {Live ? <Live staticBody={children} art={art} styles={HERO_STYLES} onPickStyle={pick} dockSlot={dockSlot} describedBy={savedId} onReady={onReady} /> : children}
              </div>
            </div>
          </div>
          {/* The page tools dock sticks to the bottom of the note while it's on screen. */}
          <div ref={setDockSlot} className="mk-hero-dock-slot" />
        </article>

        <div className="mk-hero-actions">
          <div className="min-w-0">{actions}</div>
          <div className="mk-hero-picker">
            <p id="hero-note-style" className="text-[13.5px] text-(--color-ink-muted)">
              Note style: <span className="font-semibold text-(--color-heading)">{art.name}</span>
            </p>
            <div role="radiogroup" aria-labelledby="hero-note-style" className="flex items-center gap-2">
              {HERO_STYLES.map((style, i) => {
                const checked = i === index;
                return (
                  <button
                    key={style.id}
                    ref={(node) => {
                      refs.current[i] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={style.name}
                    tabIndex={checked ? 0 : -1}
                    onClick={() => pick(i)}
                    onKeyDown={onKey}
                    className="mk-hero-swatch"
                    style={{ backgroundImage: `url("${glow(style)}")` }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One layer of artwork. The first one is in the page's HTML; later ones fade in once their image has loaded. */
function FadeImage({
  src,
  srcSet,
  sizes,
  phoneSrc,
  first,
  priority,
  className,
  onShown,
}: {
  src: string;
  srcSet?: string;
  sizes?: string;
  /** A crop for phones, used below 640 px. */
  phoneSrc?: string;
  first: boolean;
  priority?: boolean;
  className?: string;
  onShown?: () => void;
}) {
  const [ready, setReady] = useState(first);
  const show = () => {
    if (ready) return;
    setReady(true);
    onShown?.();
  };
  return (
    <picture>
      {phoneSrc ? <source media={HERO_PHONE_MEDIA} srcSet={phoneSrc} /> : null}
      <img
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        alt=""
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        ref={(node) => {
          if (node?.complete && node.naturalWidth) show();
        }}
        onLoad={show}
        data-ready={ready ? "true" : undefined}
        className={cx("mk-hero-layer", className)}
      />
    </picture>
  );
}
