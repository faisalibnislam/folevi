"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Search, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { clearFind, findState, replaceAll, replaceCurrent, setFind, type FindState } from "@/components/editor/findReplace";

/**
 * The find & replace bar floating at the top of the note (⌘F finds, ⌘⌥F or the page menu replaces).
 * Enter / Shift+Enter step through matches, Escape closes and puts the cursor on the current match.
 * Matches are painted in the editor itself; replacing edits through the editor, so it syncs and ⌘Z undoes it.
 */
export function FindBar({ editor, withReplace, focusKey, readOnly, onClose }: { editor: Editor; withReplace: boolean; /** Changes each time ⌘F/⌘⌥F is pressed again, to refocus the bar. */ focusKey: number; readOnly: boolean; onClose: () => void }) {
  const [state, setState] = useState<FindState>(() => findState(editor));
  const [query, setQuery] = useState(() => {
    // Start from the selected words, when a short piece of one line is selected.
    const { from, to } = editor.state.selection;
    const text = from < to ? editor.state.doc.textBetween(from, to, " ") : "";
    return text && text.length <= 100 && !text.includes("\n") ? text : "";
  });
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(withReplace && !readOnly);
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const id = useId();

  // Follow the plugin (matches change as the note is edited, here or elsewhere).
  useEffect(() => {
    const sync = () => setState(findState(editor));
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  useEffect(() => {
    setFind(editor, { query, index: 0 });
  }, [editor, query]);

  // Leaving (closing the bar or the note) clears the highlights.
  useEffect(() => () => clearFind(editor), [editor]);

  useEffect(() => {
    if (withReplace && !readOnly) {
      setShowReplace(true);
      requestAnimationFrame(() => replaceRef.current?.select());
    } else {
      findRef.current?.focus();
      findRef.current?.select();
    }
  }, [focusKey, withReplace, readOnly]);

  const count = state.matches.length;
  const step = (delta: 1 | -1) => count && setFind(editor, { index: state.index + delta });
  const close = () => {
    const m = state.matches[state.index];
    onClose();
    // Back to the note, with the current match selected.
    if (m) editor.chain().focus().setTextSelection({ from: m.from, to: m.to }).run();
    else editor.commands.focus();
  };
  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const status = !query ? "" : count ? `${state.index + 1} of ${count}${count >= 1000 ? "+" : ""}` : "No results";

  return (
    <div
      role="search"
      aria-label="Find in note"
      onKeyDown={onKeys}
      className="ui-pop absolute right-3 top-3 z-30 w-[min(460px,calc(100%-24px))] rounded-[12px] p-1.5 animate-[folio-rise_140ms_var(--ease-folio)] motion-reduce:animate-none"
    >
      <div className="flex items-center gap-0.5">
        {!readOnly ? (
          <IconButton
            label={showReplace ? "Hide replace" : "Show replace"}
            aria-expanded={showReplace}
            aria-controls={`${id}-replace`}
            onClick={() => setShowReplace((v) => !v)}
            className="!h-8 !w-7"
          >
            {showReplace ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          </IconButton>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <label htmlFor={`${id}-find`} className="sr-only">
            Find
          </label>
          <input
            id={`${id}-find`}
            ref={findRef}
            type="text"
            autoComplete="off"
            enterKeyHint="search"
            value={query}
            placeholder="Find in note"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
            aria-describedby={`${id}-count`}
            className="ui-input h-8 w-full rounded-[6px] pl-7 pr-2 text-[13px]"
          />
        </div>
        <span id={`${id}-count`} role="status" aria-live="polite" className="min-w-[4.5rem] flex-none px-1.5 text-right text-[12px] tabular-nums text-muted">
          {status}
        </span>
        <IconButton
          label="Match case"
          aria-pressed={state.caseSensitive}
          onClick={() => setFind(editor, { caseSensitive: !state.caseSensitive, index: 0 })}
          className={`!h-8 !w-8 ${state.caseSensitive ? "!bg-heading !text-canvas" : ""}`}
        >
          <CaseSensitive size={16} aria-hidden />
        </IconButton>
        <IconButton label="Previous match" shortcut="Shift+Enter" disabled={!count} onClick={() => step(-1)} className="!h-8 !w-8">
          <ChevronUp size={15} aria-hidden />
        </IconButton>
        <IconButton label="Next match" shortcut="Enter" disabled={!count} onClick={() => step(1)} className="!h-8 !w-8">
          <ChevronDown size={15} aria-hidden />
        </IconButton>
        <IconButton label="Close find" shortcut="Esc" onClick={close} className="!h-8 !w-8">
          <X size={15} aria-hidden />
        </IconButton>
      </div>
      {showReplace && !readOnly ? (
        <div id={`${id}-replace`} className="mt-1 flex items-center gap-1 pl-7">
          <label htmlFor={`${id}-with`} className="sr-only">
            Replace with
          </label>
          <input
            id={`${id}-with`}
            ref={replaceRef}
            type="text"
            autoComplete="off"
            value={replacement}
            placeholder="Replace with"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                replaceCurrent(editor, replacement);
              }
            }}
            className="ui-input h-8 min-w-0 flex-1 rounded-[6px] px-2.5 text-[13px]"
          />
          <button type="button" disabled={!count} onClick={() => replaceCurrent(editor, replacement)} className="ui-btn ui-btn-secondary h-8 flex-none px-3 text-[12.5px] disabled:opacity-40">
            Replace
          </button>
          <button
            type="button"
            disabled={!count}
            onClick={() => {
              const n = replaceAll(editor, replacement);
              if (n) toast.show(`Replaced ${n.toLocaleString()} ${n === 1 ? "match" : "matches"}`, { action: { label: "Undo", onClick: () => editor.commands.undo() } });
            }}
            className="ui-btn ui-btn-secondary h-8 flex-none px-3 text-[12.5px] disabled:opacity-40"
          >
            Replace all
          </button>
        </div>
      ) : null}
    </div>
  );
}
