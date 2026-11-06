"use client";

import { CalendarCheck, Kanban, LockKeyhole, SquareSlash, Users } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import type { ChapterId, ShowcaseFrame } from "../showcase/script";
import { cx } from "../ui";

/*
 * The apps at work, live: the real Folevi app runs in the Mac window and on the iPhone (/showcase-app, local mode on
 * a demo workspace kept in memory, nothing sent anywhere), and a script plays it like a person would: a pointer
 * moves and clicks, words are typed letter by letter, menus open with the app's own motion. Both devices share one
 * library, so the iPhone picks up each change from the Mac a moment later, as sync does. The frames load when the
 * section comes near the screen. The loop waits while the pointer or focus is on it (after the chapter playing),
 * the tabs underneath jump to a chapter, and with reduced motion each chapter shows its end and nothing moves by
 * itself. The scene is one picture to assistive tech; the frames never take focus or clicks.
 */

const CHAPTERS: Array<{ id: ChapterId; label: string; says: string }> = [
  { id: "write", label: "Write with /", says: "A page called Spring launch: the / menu adds a table of who does what." },
  { id: "together", label: "Write together", says: "Sam edits the same page live, Maya leaves a comment for him and he replies." },
  { id: "tasks", label: "Tasks and calendar", says: "This week's tasks with their dates, one ticked off, then the same tasks on the calendar." },
  { id: "board", label: "Databases", says: "The Content plan collection as a table, then as a board grouped by status." },
  { id: "ai", label: "Foli AI", says: "Foli AI is asked what's left before the launch and answers with sources from the workspace." },
  { id: "vault", label: "Vault", says: "The Vault keeps passwords, an API key and a 2FA code behind a passcode." },
];
const ICONS: Record<ChapterId, ReactNode> = {
  write: <SquareSlash size={15} aria-hidden="true" />,
  together: <Users size={15} aria-hidden="true" />,
  tasks: <CalendarCheck size={15} aria-hidden="true" />,
  board: <Kanban size={15} aria-hidden="true" />,
  ai: <AiIcon size={15} />,
  vault: <LockKeyhole size={15} aria-hidden="true" />,
};
/** About how long a chapter plays, for the tab's progress line. */
const CHAPTER_MS = 9000;
const MAC_W = 1280;
const MAC_H = 800;
const PHONE_W = 402;
const PHONE_H = 874;

/** The iPhone's status bar (the app leaves its 62 points free): the time, the Dynamic Island, signal, Wi-Fi, battery. */
function StatusBar() {
  return (
    <div className="absolute inset-x-0 top-0 h-[62px] text-black">
      <span className="absolute text-[17px] font-semibold tracking-[-0.01em]" style={{ left: 50, top: 21, fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif" }}>
        9:41
      </span>
      <span className="absolute h-[37px] w-[126px] rounded-chip bg-black" style={{ left: 138, top: 11 }} />
      <svg className="absolute" style={{ right: 26, top: 26 }} width="78" height="13" viewBox="0 0 78 13" aria-hidden="true">
        <rect x="0" y="9" width="3" height="4" rx="1" fill="currentColor" />
        <rect x="4.5" y="6.5" width="3" height="6.5" rx="1" fill="currentColor" />
        <rect x="9" y="4" width="3" height="9" rx="1" fill="currentColor" />
        <rect x="13.5" y="1" width="3" height="12" rx="1" fill="currentColor" />
        <path d="M30.5 3.2a9.6 9.6 0 0 1 12.9 0l1.2-1.2a11.3 11.3 0 0 0-15.3 0Zm2.4 2.4a6.2 6.2 0 0 1 8.1 0l1.2-1.2a7.9 7.9 0 0 0-10.5 0Zm2.4 2.4a2.8 2.8 0 0 1 3.3 0L37 10.4Z" fill="currentColor" />
        <rect x="50.5" y="0.5" width="24" height="12" rx="3.8" fill="none" stroke="currentColor" strokeOpacity=".4" />
        <rect x="52.5" y="2.5" width="20" height="8" rx="2.2" fill="currentColor" />
        <path d="M76 4.5v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" fillOpacity=".45" />
      </svg>
    </div>
  );
}

/** A frame's showcase side, once its app has started. */
async function frameOf(iframe: HTMLIFrameElement | null, signal: AbortSignal): Promise<ShowcaseFrame | null> {
  while (!signal.aborted) {
    const f = (iframe?.contentWindow as (Window & { __foleviShowcase?: ShowcaseFrame }) | null)?.__foleviShowcase;
    if (f) {
      await f.ready;
      return f;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

/** Scales a fixed-size frame to the width of its box. */
function useScale(ref: React.RefObject<HTMLDivElement | null>, width: number): number {
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale((e?.contentRect.width ?? width) / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, width]);
  return scale;
}

export function DeviceShowcase() {
  const [chapter, setChapter] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  const [near, setNear] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [ready, setReady] = useState(false);
  const [phoneOn, setPhoneOn] = useState(false);
  // A new library each visit: the Mac and the iPhone find each other by it.
  const [session] = useState(() => Math.random().toString(36).slice(2, 10));
  // Development: ?showcase=manual plays nothing by itself (chapters are played from the console).
  const [manual] = useState(() => process.env.NODE_ENV !== "production" && typeof location !== "undefined" && location.search.includes("showcase=manual"));
  const root = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const macFrame = useRef<HTMLIFrameElement>(null);
  const phoneFrame = useRef<HTMLIFrameElement>(null);
  const frames = useRef<{ mac: ShowcaseFrame | null; phone: ShowcaseFrame | null }>({ mac: null, phone: null });
  const scale = useScale(win, MAC_W);
  const phoneScale = useScale(screen, PHONE_W);
  // Which chapter is playing, and how to stop it.
  const playing = useRef<{ index: number; stop: AbortController } | null>(null);
  const [played, setPlayed] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setStill(reduce.matches);
    apply();
    reduce.addEventListener("change", apply);
    return () => reduce.removeEventListener("change", apply);
  }, []);

  // Load when the section comes near; play only while it's on screen.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const nearBy = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "800px 0px" });
    const seen = new IntersectionObserver(([e]) => setOnScreen(Boolean(e?.isIntersecting)), { threshold: 0.25 });
    nearBy.observe(el);
    seen.observe(el);
    return () => {
      nearBy.disconnect();
      seen.disconnect();
    };
  }, []);

  // The Mac's app first (it hosts the library), then the iPhone's, which joins it.
  useEffect(() => {
    if (!near) return;
    const stop = new AbortController();
    void (async () => {
      frames.current.mac = await frameOf(macFrame.current, stop.signal);
      if (!frames.current.mac) return;
      setPhoneOn(true);
      await new Promise((r) => setTimeout(r, 50));
      frames.current.phone = await frameOf(phoneFrame.current, stop.signal);
      if (!stop.signal.aborted) setReady(true);
    })();
    return () => stop.abort();
  }, [near]);

  // Plays the chapter shown, then moves on (unless held).
  useEffect(() => {
    const mac = frames.current.mac;
    if (!ready || !mac || manual) return;
    if (playing.current?.index === chapter) return;
    playing.current?.stop.abort();
    const stop = new AbortController();
    playing.current = { index: chapter, stop };
    void mac.play(CHAPTERS[chapter]!.id, { signal: stop.signal, phone: frames.current.phone, still }).then(() => {
      if (stop.signal.aborted) return;
      setPlayed((n) => n + 1);
    });
  }, [ready, chapter, still, manual]);

  // The next chapter, once this one is done, if nobody's holding the scene and it's on screen.
  useEffect(() => {
    if (!played || still || paused || !onScreen) return;
    const t = setTimeout(() => {
      playing.current = null;
      setChapter((c) => (c + 1) % CHAPTERS.length);
    }, 900);
    return () => clearTimeout(t);
  }, [played, still, paused, onScreen]);

  useEffect(() => () => playing.current?.stop.abort(), []);

  const go = (i: number) => {
    playing.current?.stop.abort();
    playing.current = null;
    setPlayed(0);
    setChapter(i);
  };
  const c = CHAPTERS[chapter]!;
  const src = (device: "mac" | "phone") => `/showcase-app?s=${session}&device=${device}`;

  return (
    <div ref={root} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div role="img" aria-label={`Folevi on a Mac and an iPhone. ${c.says}`} className="relative mx-auto w-full max-w-[1060px] pb-[6%] pr-[9%]">
        <div aria-hidden="true">
          {/* The Mac window: the app at 1280 × 800, scaled, with the window's corners and shadow. */}
          <div ref={win} className="mk-mac-window relative aspect-[16/10] w-full overflow-hidden bg-(--color-surface-sunken)">
            {near && scale ? (
              <iframe
                ref={macFrame}
                src={src("mac")}
                title=""
                tabIndex={-1}
                className={cx("pointer-events-none absolute left-0 top-0 origin-top-left border-0 transition-opacity duration-700 ease-out", ready ? "opacity-100" : "opacity-0")}
                style={{ width: MAC_W, height: MAC_H, transform: `scale(${scale})` }}
              />
            ) : null}
          </div>
          {/* The iPhone, in front of the window's lower right corner. */}
          <div className="mk-phone absolute bottom-0 right-0 w-[24%] bg-[#111113] p-[0.6%] shadow-[0_30px_60px_-18px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.08)_inset]">
            <div ref={screen} className="mk-phone-screen relative aspect-[402/874] overflow-hidden bg-(--color-surface)">
              {phoneScale ? (
                <div className="absolute left-0 top-0 origin-top-left" style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${phoneScale})` }}>
                  {phoneOn ? (
                    <iframe
                      ref={phoneFrame}
                      src={src("phone")}
                      title=""
                      tabIndex={-1}
                      className={cx("pointer-events-none absolute inset-0 border-0 transition-opacity duration-700 ease-out", ready ? "opacity-100" : "opacity-0")}
                      style={{ width: PHONE_W, height: PHONE_H }}
                    />
                  ) : null}
                  <StatusBar />
                  <span className="absolute bottom-2 left-1/2 h-[5px] w-[140px] -translate-x-1/2 rounded-chip bg-black" />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div role="tablist" aria-label="What the apps can do" className="mx-auto mt-6 flex max-w-full flex-wrap justify-center gap-1.5">
        {CHAPTERS.map((ch, i) => (
          <button
            key={ch.id}
            type="button"
            role="tab"
            aria-selected={i === chapter}
            onClick={() => go(i)}
            className={cx(
              "relative flex items-center gap-1.5 overflow-hidden rounded-chip px-3.5 py-2 text-[13px] font-medium transition-colors",
              i === chapter ? "bg-(--color-heading) text-(--color-canvas)" : "bg-(--color-surface-sunken) text-muted hover:bg-(--glass-hover) hover:text-(--color-heading)",
            )}
          >
            {ICONS[ch.id]}
            {ch.label}
            {i === chapter && ready && !still ? (
              <span key={`${chapter}-${played}`} aria-hidden="true" className="mk-showcase-progress absolute bottom-0 left-0 h-0.5 w-full origin-left bg-(--color-canvas) opacity-60" style={{ animationDuration: `${CHAPTER_MS}ms` }} />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
