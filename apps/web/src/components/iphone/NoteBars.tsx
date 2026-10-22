"use client";

import { useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { AtSign, ChevronDown, Image as ImageIcon, IndentDecrease, IndentIncrease, Link2, MessageCircle, Paintbrush, Plus, Redo2, SquareCheck, Type, Undo2 } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { applyLink, changeDepth, turnInto } from "@/components/editor/commands";
import { requestSpecialInsert } from "@/components/editor/EditorMenus";
import type { InspectorTab } from "@/components/doc/Inspector";
import { useToast } from "@/components/ui/Toast";
import { KEYBOARD_EASE, askText, feel, onKeyboardFrame, prepareFeel, setKeyboardInteractiveDismiss, type NativeKeyboardFrame } from "@/lib/native/ui";
import { PillButton } from "./Glass";
import { useIphoneChrome } from "./chrome";
import "./editor-phone.css";

/**
 * A note's floating bars in the iPhone app: on the left Comments, Style and Format, on the right Foli AI and
 * Insert. Each opens its tool as a sheet. While the keyboard is up they give way to one bar riding on the
 * keyboard (docs/IOS_POLISH_PLAN.md §4.6): Insert and Format first, then the blocks and marks people reach for
 * most, and a key that puts the keyboard away. The note's top bar steps aside while writing, too (editor-phone.css).
 */
export function NoteBars({ editor, ai, open, tab, onPick, readOnly }: { editor: Editor | null; ai: boolean; open: boolean; tab: InspectorTab; onPick: (t: InspectorTab) => void; readOnly: boolean }) {
  const { keyboard } = useIphoneChrome();
  const editing = keyboard && Boolean(editor?.isFocused || editor?.view.hasFocus());
  const writing = editing && Boolean(editor) && !readOnly;
  // (Followed from the start: the keyboard's first move can come before the bar on it is drawn.)
  const ride = useKeyboardRide();
  // While writing, the note has the screen: its top bar fades out (editor-phone.css, [data-iphone-writing]).
  useEffect(() => {
    const root = document.documentElement;
    if (writing && !open) root.dataset.iphoneWriting = "";
    else delete root.dataset.iphoneWriting;
    return () => {
      delete root.dataset.iphoneWriting;
    };
  }, [writing, open]);
  // A drag down the note takes the keyboard away with the finger, as in Notes and Craft.
  useEffect(() => {
    if (!editor || readOnly) return;
    setKeyboardInteractiveDismiss(true);
    return () => setKeyboardInteractiveDismiss(false);
  }, [editor, readOnly]);
  if (writing && editor) return open ? null : <KeyboardBar editor={editor} onPick={onPick} ride={ride} />;
  const on = (t: InspectorTab) => open && tab === t;
  const btn = (t: InspectorTab, label: string, icon: ReactNode) => (
    <PillButton
      label={label}
      pressed={on(t)}
      aria-controls={on(t) ? "document-inspector" : undefined}
      // The caret stays in the note when a tool opens.
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={() => prepareFeel("toggle")}
      onClick={() => {
        feel("toggle");
        onPick(t);
      }}
      className="!h-[52px] !min-w-[52px]"
    >
      {icon}
    </PillButton>
  );
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-end justify-between gap-3 px-4 pb-[max(10px,calc(env(safe-area-inset-bottom)-10px))] pl-[calc(16px+env(safe-area-inset-left))] pr-[calc(16px+env(safe-area-inset-right))] ${keyboard ? "hidden" : ""}`}
    >
      {/* One weight for every icon: 24 pt at a 2 pt stroke, each drawn to the same optical size. */}
      <div role="toolbar" aria-label="Note tools" className="ui-liquid pointer-events-auto flex h-[60px] items-center gap-0.5 rounded-capsule p-1">
        {btn("comments", "Comments", <MessageCircle size={23} strokeWidth={2} aria-hidden />)}
        {readOnly ? null : btn("style", "Style", <Paintbrush size={22} strokeWidth={1.85} aria-hidden />)}
        {readOnly ? null : btn("format", "Format", <Type size={24} strokeWidth={2} aria-hidden />)}
      </div>
      <div role="toolbar" aria-label="Add to the note" className="ui-liquid pointer-events-auto flex h-[60px] items-center gap-0.5 rounded-capsule p-1">
        {ai ? btn("ai", "Foli AI", <AiIcon size={26} />) : null}
        {readOnly ? null : (
          <PillButton
            label="Insert"
            pressed={on("insert")}
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={() => prepareFeel("toggle")}
            onClick={() => {
              feel("toggle");
              onPick("insert");
            }}
            className="!h-[52px] !min-w-[52px]"
          >
            <span className="grid h-[38px] w-[38px] place-items-center rounded-capsule bg-heading text-canvas shadow-[0_2px_6px_rgb(0_0_0/0.18)]">
              <Plus size={22} strokeWidth={2.4} aria-hidden />
            </span>
          </PillButton>
        )}
      </div>
    </div>
  );
}

/**
 * Moves the bar over the keyboard with the keyboard. The app says where the keyboard is going (and how fast)
 * before it moves, so the bar rides with it in the same frames. The web view also shrinks while the keyboard
 * is up, moving the page's bottom edge (where the bar is anchored) at once: the bar is kept where it was on
 * screen when that happens and carries on to where it's going in the time the keyboard has left. Returns the
 * bar's ref.
 */
function useKeyboardRide(): (el: HTMLElement | null) => void {
  const state = useRef({ frame: null as NativeKeyboardFrame | null, at: 0, rest: 0, inner: 0 });
  const bar = useRef<HTMLElement | null>(null);
  const ride = useRef<{ apply: (el: HTMLElement, shift: number, ms: number) => void; mount: (el: HTMLElement) => void } | null>(null);
  if (!ride.current) {
    // How high above the page's bottom edge the bar belongs: the keyboard's height less what the web view
    // already gave up for it.
    const target = () => {
      const s = state.current;
      if (!s.frame) return 0;
      return Math.max(0, Math.round(s.frame.height - Math.max(0, s.rest - window.innerHeight)));
    };
    const left = () => {
      const s = state.current;
      return s.frame && s.frame.duration > 0 ? Math.max(0, s.frame.duration - (performance.now() - s.at)) : 0;
    };
    const now = (el: HTMLElement) => {
      try {
        return new DOMMatrixReadOnly(getComputedStyle(el).transform === "none" ? undefined : getComputedStyle(el).transform).m42;
      } catch {
        return 0;
      }
    };
    const move = (el: HTMLElement, from: number, ms: number) => {
      const to = -target();
      el.style.transition = "none";
      el.style.transform = `translate3d(0, ${from}px, 0)`;
      if (ms > 0 && Math.abs(to - from) > 0.5) {
        void el.offsetHeight;
        el.style.transition = `transform ${Math.round(ms)}ms ${state.current.frame?.curve === "linear" ? "linear" : KEYBOARD_EASE}`;
      }
      el.style.transform = `translate3d(0, ${to}px, 0)`;
    };
    ride.current = {
      apply: (el, shift, ms) => move(el, now(el) + shift, ms),
      // Drawn while the keyboard is still coming up: it starts below the screen's edge, as the keyboard did.
      mount: (el) => move(el, left() > 0 ? Math.max(0, state.current.rest - window.innerHeight) + 64 : -target(), left()),
    };
  }
  useEffect(() => {
    const s = state.current;
    s.rest = s.inner = window.innerHeight;
    const stop = onKeyboardFrame((f) => {
      if (!f.visible) s.rest = Math.max(s.rest, window.innerHeight);
      s.frame = f;
      s.at = performance.now();
      if (bar.current) ride.current!.apply(bar.current, 0, f.duration);
    });
    const onResize = () => {
      // The page's bottom edge moved up by `moved` (or down): the bar stays where it is on screen.
      const moved = s.inner - window.innerHeight;
      s.inner = window.innerHeight;
      if (!document.documentElement.hasAttribute("data-iphone-keyboard") && !s.frame?.visible) s.rest = window.innerHeight;
      else s.rest = Math.max(s.rest, window.innerHeight);
      if (bar.current) {
        const ms = s.frame && s.frame.duration > 0 ? Math.max(0, s.frame.duration - (performance.now() - s.at)) : 0;
        ride.current!.apply(bar.current, moved, ms);
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      stop();
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return useCallback((el: HTMLElement | null) => {
    bar.current = el;
    if (el) ride.current!.mount(el);
  }, []);
}

/** The bar over the keyboard while writing. Its buttons never take focus, so the keyboard stays up. */
function KeyboardBar({ editor, onPick, ride }: { editor: Editor; onPick: (t: InspectorTab) => void; ride: (el: HTMLElement | null) => void }) {
  // Re-render as the caret moves, so the buttons show what the line is.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  // Where a finger went down: lifting it far from there was a scroll along the bar, not a tap.
  const down = useRef<{ x: number; y: number } | null>(null);
  const toast = useToast();
  useEffect(() => {
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);
  const node = editor.state.selection.$from.depth >= 1 ? editor.state.selection.$from.node(1) : null;
  const type = node?.type.name;
  const toggle = (t: string, attrs: Record<string, unknown> = {}) => {
    feel("choose");
    if (type === t) turnInto(editor, "paragraph");
    else turnInto(editor, t, attrs);
  };
  const link = async () => {
    const current = String(editor.getAttributes("link").href ?? "");
    const href = await askText({ title: current ? "Edit link" : "Add link", value: current, placeholder: "Paste or type a link", confirm: current ? "Update" : "Link", capitalize: "none", maxLength: 2000 });
    if (href === null) return editor.commands.focus();
    if (!applyLink(editor, href)) toast.show("That doesn’t look like a web address.", { tone: "error" });
  };
  const key = (label: string, icon: ReactNode, run: () => void, opts: { pressed?: boolean; disabled?: boolean; menu?: boolean } = {}) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={opts.pressed}
      aria-haspopup={opts.menu ? "dialog" : undefined}
      disabled={opts.disabled}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        const t = e.touches[0];
        down.current = t ? { x: t.clientX, y: t.clientY } : null;
        prepareFeel("choose");
      }}
      onTouchEnd={(e) => {
        // A tap is handled here, without the click that would follow: the editor keeps its focus.
        e.preventDefault();
        const t = e.changedTouches[0];
        const start = down.current;
        down.current = null;
        if (!t || !start || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10 || opts.disabled) return;
        run();
      }}
      onClick={run}
      className={`grid h-11 w-11 flex-none place-items-center rounded-capsule text-heading outline-none transition-[background-color,color] duration-150 active:bg-[var(--liquid-press)] disabled:opacity-30 ${opts.pressed ? "bg-heading !text-canvas" : ""}`}
    >
      {icon}
    </button>
  );
  const icon = { size: 22, strokeWidth: 2, "aria-hidden": true } as const;
  return (
    <div
      data-iphone-keyboard-bar=""
      className="fixed inset-x-0 bottom-0 z-40 px-2 pb-2 pl-[calc(8px+env(safe-area-inset-left))] pr-[calc(8px+env(safe-area-inset-right))]"
      ref={ride}
    >
      <div role="toolbar" aria-label="Writing tools" className="ui-liquid flex h-12 items-center rounded-capsule px-0.5">
        <div className="iphone-kb-scroll flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {key("Insert", <Plus size={23} strokeWidth={2.2} aria-hidden />, () => {
            feel("toggle");
            onPick("insert");
          }, { menu: true })}
          {key("Format", <span className="text-[17px] font-semibold leading-none tracking-[-0.01em]">Aa</span>, () => {
            feel("toggle");
            onPick("format");
          }, { menu: true })}
          {key("To-do", <SquareCheck {...icon} />, () => toggle("todo", { checked: false }), { pressed: type === "todo" })}
          {key("Indent", <IndentIncrease {...icon} />, () => {
            feel("choose");
            changeDepth(editor, 1);
          })}
          {key("Outdent", <IndentDecrease {...icon} />, () => {
            feel("choose");
            changeDepth(editor, -1);
          })}
          {key("Link", <Link2 {...icon} />, () => void link(), { pressed: editor.isActive("link") })}
          {key("Mention a date or page", <AtSign {...icon} />, () => {
            feel("choose");
            editor.chain().focus().insertContent("@").run();
          })}
          {key("Image", <ImageIcon {...icon} />, () => requestSpecialInsert(editor, "image"))}
          {key("Undo", <Undo2 {...icon} />, () => editor.commands.undo(), { disabled: !editor.can().undo() })}
          {key("Redo", <Redo2 {...icon} />, () => editor.commands.redo(), { disabled: !editor.can().redo() })}
        </div>
        <span aria-hidden className="mx-0.5 h-6 w-px flex-none bg-[var(--iphone-separator)]" />
        {key("Hide keyboard", <ChevronDown size={24} strokeWidth={2.2} aria-hidden />, () => {
          editor.commands.blur();
          (document.activeElement as HTMLElement | null)?.blur();
        })}
      </div>
    </div>
  );
}
