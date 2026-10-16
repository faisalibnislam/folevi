"use client";

import { useEffect, useReducer, useRef, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, Heading2, Image as ImageIcon, IndentDecrease, IndentIncrease, List, MessageCircle, Paintbrush, Plus, Redo2, SquareCheck, Type, Undo2 } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";
import { changeDepth, turnInto } from "@/components/editor/commands";
import { requestSpecialInsert } from "@/components/editor/EditorMenus";
import type { InspectorTab } from "@/components/doc/Inspector";
import { haptic } from "@/lib/nativeApp";
import { PillButton } from "./Glass";
import { useIphoneChrome } from "./chrome";

/**
 * A note's floating bars in the iPhone app: on the left Comments, Style and Format, on the right Foli AI and
 * Insert. Each opens its tool as a sheet. While the keyboard is up they give way to a bar over the keyboard
 * with the blocks people reach for most (to-do, bullets, a heading, indent and outdent, a picture), undo and
 * redo, and a key that puts the keyboard away (typing / still opens every block).
 */
export function NoteBars({ editor, ai, open, tab, onPick, readOnly }: { editor: Editor | null; ai: boolean; open: boolean; tab: InspectorTab; onPick: (t: InspectorTab) => void; readOnly: boolean }) {
  const { keyboard } = useIphoneChrome();
  const editing = keyboard && Boolean(editor?.isFocused || editor?.view.hasFocus());
  if (editing && editor && !readOnly) return <KeyboardBar editor={editor} />;
  const on = (t: InspectorTab) => open && tab === t;
  const btn = (t: InspectorTab, label: string, icon: ReactNode) => (
    <PillButton
      label={label}
      pressed={on(t)}
      aria-controls={on(t) ? "document-inspector" : undefined}
      // The caret stays in the note when a tool opens.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptic("light");
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
      <div role="toolbar" aria-label="Note tools" className="ui-liquid pointer-events-auto flex h-[60px] items-center gap-0.5 rounded-capsule p-1">
        {btn("comments", "Comments", <MessageCircle size={22} strokeWidth={1.9} aria-hidden />)}
        {readOnly ? null : btn("style", "Style", <Paintbrush size={21} strokeWidth={1.9} aria-hidden />)}
        {readOnly ? null : btn("format", "Format", <Type size={22} strokeWidth={1.9} aria-hidden />)}
      </div>
      <div role="toolbar" aria-label="Add to the note" className="ui-liquid pointer-events-auto flex h-[60px] items-center gap-0.5 rounded-capsule p-1">
        {ai ? btn("ai", "Foli AI", <AiIcon size={26} />) : null}
        {readOnly ? null : (
          <PillButton
            label="Insert"
            pressed={on("insert")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              haptic("light");
              onPick("insert");
            }}
            className="!h-[52px] !min-w-[52px]"
          >
            <span className="grid h-[38px] w-[38px] place-items-center rounded-capsule bg-heading text-canvas shadow-[0_2px_6px_rgb(0_0_0/0.18)]">
              <Plus size={22} strokeWidth={2.6} aria-hidden />
            </span>
          </PillButton>
        )}
      </div>
    </div>
  );
}

/** The bar over the keyboard while writing. Its buttons never take focus, so the keyboard stays up. */
function KeyboardBar({ editor }: { editor: Editor }) {
  // Re-render as the caret moves, so the buttons show what the line is.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  // Where a finger went down: lifting it far from there was a scroll along the bar, not a tap.
  const down = useRef<{ x: number; y: number } | null>(null);
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
    haptic("light");
    if (type === t) turnInto(editor, "paragraph");
    else turnInto(editor, t, attrs);
  };
  const key = (label: string, icon: ReactNode, run: () => void, pressed?: boolean, disabled?: boolean) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        const t = e.touches[0];
        down.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        // A tap is handled here, without the click that would follow: the editor keeps its focus.
        e.preventDefault();
        const t = e.changedTouches[0];
        const start = down.current;
        down.current = null;
        if (!t || !start || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10 || disabled) return;
        run();
      }}
      onClick={run}
      className={`grid h-10 w-[38px] flex-none place-items-center rounded-control text-heading outline-none transition-colors active:bg-[var(--liquid-press)] disabled:opacity-35 ${pressed ? "bg-[var(--liquid-active)]" : ""}`}
    >
      {icon}
    </button>
  );
  return (
    <div data-iphone-keyboard-bar="" className="fixed inset-x-0 bottom-0 z-40 px-2 pb-1.5 pl-[calc(8px+env(safe-area-inset-left))] pr-[calc(8px+env(safe-area-inset-right))]">
      <div role="toolbar" aria-label="Writing tools" className="ui-liquid-strong flex h-12 items-center gap-0.5 rounded-capsule pl-1 pr-1">
        <div className="flex min-w-0 flex-1 items-center justify-between overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {key("To-do", <SquareCheck size={20} strokeWidth={2} aria-hidden />, () => toggle("todo"), type === "todo")}
          {key("Bulleted list", <List size={21} strokeWidth={2} aria-hidden />, () => toggle("bulleted"), type === "bulleted")}
          {key("Heading", <Heading2 size={21} strokeWidth={2} aria-hidden />, () => toggle("heading", { level: 2 }), type === "heading")}
          {key("Outdent", <IndentDecrease size={20} strokeWidth={2} aria-hidden />, () => changeDepth(editor, -1))}
          {key("Indent", <IndentIncrease size={20} strokeWidth={2} aria-hidden />, () => changeDepth(editor, 1))}
          {key("Image", <ImageIcon size={20} strokeWidth={2} aria-hidden />, () => requestSpecialInsert(editor, "image"))}
          {key("Undo", <Undo2 size={20} strokeWidth={2} aria-hidden />, () => editor.commands.undo(), undefined, !editor.can().undo())}
          {key("Redo", <Redo2 size={20} strokeWidth={2} aria-hidden />, () => editor.commands.redo(), undefined, !editor.can().redo())}
        </div>
        <span aria-hidden className="mx-0.5 h-6 w-px flex-none bg-[var(--iphone-separator)]" />
        {key("Hide keyboard", <ChevronDown size={22} strokeWidth={2.2} aria-hidden />, () => {
          editor.commands.blur();
          (document.activeElement as HTMLElement | null)?.blur();
        })}
      </div>
    </div>
  );
}
