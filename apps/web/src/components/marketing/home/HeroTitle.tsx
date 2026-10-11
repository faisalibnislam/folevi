"use client";

import { useEffect, useRef, useState } from "react";

/*
 * The hero's title, being edited by a few people at once: "Folevi is a digital workspace for …", and each in
 * turn deletes the ending and types their own, with their cursor and name where they type (as collaborators
 * show in a shared note). Assistive tech and search engines read the whole sentence once (the typing is
 * hidden from them). The title can be edited too: the moment someone clicks or tabs into it, the others stop
 * typing and leave it to them. With reduced motion, the first ending holds still.
 */

/** The first line stays; the second ("for …") is the one people change. Endings fit on one line. */
const LEAD = "Folevi is a digital workspace";
const TURNS = [
  { text: "notes", who: "Maya", color: "#6C5CE0" },
  { text: "documentation", who: "Sam", color: "#D9603F" },
  { text: "collaboration", who: "Ines", color: "#22927F" },
  { text: "publishing", who: "Maya", color: "#6C5CE0" },
  { text: "team wikis", who: "Sam", color: "#D9603F" },
  { text: "planning your week", who: "Ines", color: "#22927F" },
];
/** What the sentence says, for screen readers and the page's text. */
export const HERO_TITLE_TEXT = `${LEAD} for notes, documentation, collaboration and publishing.`;

const HOLD_MS = 2400;
const DELETE_MS = 38;
const TYPE_MS = 75;

export function HeroTitle() {
  const [turn, setTurn] = useState(0);
  const [shown, setShown] = useState(TURNS[0]!.text);
  const [typing, setTyping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  // Clicking or tabbing into the title hands it over: the others stop for good.
  useEffect(() => {
    const title = root.current?.closest("h1");
    if (!title) return;
    const stop = () => setStopped(true);
    title.addEventListener("pointerdown", stop);
    title.addEventListener("focusin", stop);
    return () => {
      title.removeEventListener("pointerdown", stop);
      title.removeEventListener("focusin", stop);
    };
  }, []);

  useEffect(() => {
    if (stopped || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
    void (async () => {
      let i = 0;
      let text = TURNS[0]!.text;
      while (!cancelled) {
        await wait(HOLD_MS);
        if (cancelled) return;
        // The next person takes over: their cursor goes to the end, deletes the ending, types theirs.
        i = (i + 1) % TURNS.length;
        setTurn(i);
        setTyping(true);
        await wait(500);
        while (!cancelled && text.length) {
          text = text.slice(0, -1);
          setShown(text);
          await wait(DELETE_MS);
        }
        const next = TURNS[i]!.text;
        for (let n = 1; !cancelled && n <= next.length; n++) {
          text = next.slice(0, n);
          setShown(text);
          await wait(TYPE_MS + Math.random() * 60);
        }
        setTyping(false);
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [stopped]);

  const person = TURNS[turn]!;
  return (
    <span ref={root}>
      <span className="sr-only">{HERO_TITLE_TEXT}</span>
      <span aria-hidden="true" className="mk-hero-two">
        <span className="block">{LEAD}</span>
        for{" "}
        <span className="mk-hero-typed">
          <span className="mk-hero-mark" style={{ ["--who" as string]: person.color }}>
            {shown || "​"}
          </span>
          {stopped ? null : (
            <span className="mk-hero-caret" data-typing={typing || undefined} style={{ ["--who" as string]: person.color }}>
              <span className="mk-hero-caret-name">{person.who}</span>
            </span>
          )}
        </span>
        .
      </span>
    </span>
  );
}
