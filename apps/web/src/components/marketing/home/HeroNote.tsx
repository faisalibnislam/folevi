"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { preload } from "react-dom";
import { paletteVars, type CoverArt } from "@/lib/cover";
import { artVars } from "../product/Replica";
import { useSiteAmbient } from "../SiteShell";
import { cx } from "../ui";
import { HERO_STYLES, heroBand as band, heroBandSet as bandSet, heroGlow as glow } from "./heroStyles";

/** The cover band is the sheet's width: 888 px at most, else the content panel (beside the sidebar from 1024 px) less its gutters. */
const BAND_SIZES = "(min-width: 1250px) 888px, (min-width: 1024px) calc(100vw - 336px), calc(100vw - 32px)";

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

  // The first style's cover is the largest thing above the fold: fetch it early, at the size it shows.
  preload(band(HERO_STYLES[0]!), { as: "image", imageSrcSet: bandSet(HERO_STYLES[0]!), imageSizes: BAND_SIZES, fetchPriority: "high" });

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
    <div className="mk-hero-stage" style={{ ...artVars(art), ...paletteVars(art) }} data-tone={art.tone}>
      <div aria-hidden="true" className="mk-hero-backdrop">
        {layers.map((layer) => (
          <FadeImage key={layer.key} src={glow(layer.art)} first={layer.key === 0} className="mk-hero-glow" />
        ))}
      </div>

      <div className="relative mx-auto w-full max-w-[1024px] px-4 pb-8 pt-8 sm:px-8 sm:pb-12 sm:pt-12">
        <article className="mk-note mk-hero-note">
          <header className="mk-hero-cover">
            <div aria-hidden="true" className="mk-hero-art">
              {layers.map((layer) => (
                <FadeImage
                  key={layer.key}
                  src={band(layer.art)}
                  srcSet={bandSet(layer.art)}
                  sizes={BAND_SIZES}
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
            <h1 id="hero-title" className="mk-hero-title">
              {title}
            </h1>
          </header>

          <div className="mk-hero-body">
            <p className="mk-hero-badge">{chip}</p>
            {children}
          </div>
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
  first,
  priority,
  className,
  onShown,
}: {
  src: string;
  srcSet?: string;
  sizes?: string;
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
    // eslint-disable-next-line @next/next/no-img-element -- sized artwork from /public, cross-faded by hand
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
  );
}
