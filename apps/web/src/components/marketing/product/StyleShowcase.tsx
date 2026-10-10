"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../ui";
import { AppWindow, artById, artThumb } from "./Replica";

/** Five of the app's 57 note styles, by their ids in covers.json. */
const STYLES = ["art-03", "art-01", "art-30", "art-49", "art-09"].map(artById);

/**
 * A replica of the app with a note open, and the note's style as a real choice. Picking a
 * style recolours the note and the light behind the glass, as it does in the app; the chrome stays neutral.
 */
/** `artSize` "thumb" for small copies (card covers). */
export function StyleShowcase({ artSize = "large" }: { artSize?: "thumb" | "large" } = {}) {
  const [index, setIndex] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const art = STYLES[index]!;

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const jump = event.key === "Home" ? 0 : event.key === "End" ? STYLES.length - 1 : null;
    if (!step && jump === null) return;
    event.preventDefault();
    const next = jump ?? (index + step + STYLES.length) % STYLES.length;
    setIndex(next);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <AppWindow
        artSize={artSize}
        art={art}
        label={`The Folevi app with a note called Seed library open. The note uses the ${art.name} style, which colours its cover, page and text.`}
        className="h-[500px] sm:h-[540px] lg:h-[600px]"
      />
      <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
        <p id="hero-style-label" className="text-[13.5px] text-muted">
          Note style: <span className="font-semibold text-(--color-heading)">{art.name}</span>
        </p>
        <div role="radiogroup" aria-labelledby="hero-style-label" className="flex items-center gap-2">
          {STYLES.map((style, i) => {
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
                onClick={() => setIndex(i)}
                onKeyDown={onKey}
                className={cx(
                  "size-11 rounded-[10px] bg-cover bg-center transition-shadow duration-150 sm:size-9",
                  checked
                    ? "shadow-[0_0_0_2px_var(--color-canvas),0_0_0_4px_var(--color-heading)]"
                    : "shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] hover:shadow-[0_0_0_2px_var(--color-canvas),0_0_0_4px_var(--color-line-strong)]",
                )}
                style={{ backgroundImage: artThumb(style) }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
