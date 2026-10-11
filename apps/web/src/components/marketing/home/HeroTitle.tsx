"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, PEOPLE, type PersonId } from "../people";

/*
 * The hero's title, being edited by a few people at once: "Folevi is a digital workspace for …", and each in
 * turn deletes the ending and types their own, with their cursor and name where they type (as collaborators
 * show in a shared note). Assistive tech and search engines read the whole sentence once (the typing is
 * hidden from them). The title can be edited too: while someone's in it the others wait, and once they've
 * changed it, it's theirs. With reduced motion, the first ending holds still.
 */

/** The first line stays; the second ("for …") is the one people change. Endings fit on one line. */
const LEAD = "Folevi is a digital workspace";
const TURNS: { text: string; who: PersonId }[] = [
  { text: "notes", who: "maya" },
  { text: "documentation", who: "sam" },
  { text: "collaboration", who: "ines" },
  { text: "publishing", who: "maya" },
  { text: "team wikis", who: "sam" },
  { text: "planning your week", who: "ines" },
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
  // Paused while someone's in the title; stopped for good once they've changed it.
  const [paused, setPaused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const shownRef = useRef(TURNS[0]!.text);
  const turnRef = useRef(0);

  useEffect(() => {
    const title = root.current?.closest("h1");
    if (!title) return;
    const visible = () => root.current?.querySelector(".mk-hero-two")?.textContent ?? "";
    let before = "";
    const enter = () => {
      before = visible();
      setPaused(true);
    };
    const leave = () => {
      // Left as it was: the others carry on. Changed: it's theirs now.
      if (visible() === before && root.current?.isConnected) setPaused(false);
      else setStopped(true);
    };
    title.addEventListener("focusin", enter);
    title.addEventListener("focusout", leave);
    title.addEventListener("input", () => setStopped(true));
    return () => {
      title.removeEventListener("focusin", enter);
      title.removeEventListener("focusout", leave);
    };
  }, []);

  useEffect(() => {
    if (paused || stopped || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
    const show = (text: string) => {
      shownRef.current = text;
      setShown(text);
    };
    void (async () => {
      // Carries on from where it was (after a pause, mid-word too).
      let i = turnRef.current;
      let text = shownRef.current;
      if (text !== TURNS[i]!.text) {
        const target = TURNS[i]!.text;
        for (let n = text.length + 1; !cancelled && n <= target.length; n++) {
          text = target.slice(0, n);
          show(text);
          await wait(TYPE_MS + Math.random() * 60);
        }
        setTyping(false);
      }
      while (!cancelled) {
        await wait(HOLD_MS);
        if (cancelled) return;
        // The next person takes over: their cursor goes to the end, deletes the ending, types theirs.
        i = (i + 1) % TURNS.length;
        turnRef.current = i;
        setTurn(i);
        setTyping(true);
        await wait(500);
        while (!cancelled && text.length) {
          text = text.slice(0, -1);
          show(text);
          await wait(DELETE_MS);
        }
        const next = TURNS[i]!.text;
        for (let n = 1; !cancelled && n <= next.length; n++) {
          text = next.slice(0, n);
          show(text);
          await wait(TYPE_MS + Math.random() * 60);
        }
        setTyping(false);
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [paused, stopped]);

  const person = { ...PEOPLE[TURNS[turn]!.who], id: TURNS[turn]!.who };
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
          {stopped || paused ? null : (
            <span className="mk-hero-caret" data-typing={typing || undefined} style={{ ["--who" as string]: person.color }}>
              <span className="mk-hero-caret-name">
                <Avatar who={person.id} size={24} />
                {person.name}
              </span>
            </span>
          )}
        </span>
        .
      </span>
    </span>
  );
}
