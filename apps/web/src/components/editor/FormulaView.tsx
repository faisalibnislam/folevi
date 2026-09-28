"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useEffect, useId, useRef, useState } from "react";
import { LIMITS, ulid } from "@folevi/editor-schema";
import { FormulaRender } from "./RichBlocks";

/** Formula blocks inserted by this person open straight into editing. */
const OPEN_ON_MOUNT = new Set<string>();

/** Attributes for a new, empty formula that opens for editing as soon as it appears. */
export function newFormulaAttrs(): { id: string; latex: string } {
  const id = ulid();
  OPEN_ON_MOUNT.add(id);
  return { id, latex: "" };
}

/**
 * TeX formula block: rendered with KaTeX; click it (or press Enter while it is selected) to edit the
 * LaTeX inline, with a live preview. Escape, ⌘/Ctrl-Enter or leaving the field finishes.
 */
export function FormulaView({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const latex = String(node.attrs.latex ?? "");
  const id = String(node.attrs.id ?? "");
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(() => editable && OPEN_ON_MOUNT.has(id));
  const field = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  useEffect(() => {
    if (!OPEN_ON_MOUNT.delete(id) || !editing) return;
    field.current?.focus();
  }, [id, editing]);

  // Enter on the selected formula opens it for editing (keyboard access).
  useEffect(() => {
    if (!selected || !editable || editing) return;
    const dom = editor.view.dom as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      const sel = editor.state.selection;
      if (!(sel instanceof NodeSelection) || sel.node !== node) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setEditing(true);
    };
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener("keydown", onKey, true);
  }, [selected, editable, editing, editor, node]);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const finish = () => {
    setEditing(false);
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos === "number") {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
      editor.view.focus();
    }
  };

  return (
    <NodeViewWrapper className={`fb-atom fb-formula ${selected ? "fb-atom-selected" : ""}`} data-drag-handle="" aria-label="Formula">
      <div contentEditable={false} className="fb-formula-box" data-editing={editing ? "true" : "false"}>
        {editing ? (
          <div className="fb-formula-editor">
            <label className="sr-only" htmlFor={`${hintId}-field`}>
              LaTeX formula
            </label>
            <textarea
              id={`${hintId}-field`}
              ref={field}
              value={latex}
              maxLength={LIMITS.maxFormulaLength}
              spellCheck={false}
              rows={Math.min(8, Math.max(2, latex.split("\n").length))}
              placeholder="e.g. E = mc^2"
              aria-describedby={hintId}
              onChange={(e) => updateAttributes({ latex: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                  e.preventDefault();
                  finish();
                }
              }}
              onBlur={() => setEditing(false)}
              className="fb-formula-input"
            />
            <p id={hintId} className="fb-formula-hint">
              LaTeX · Esc or ⌘↩ to finish
            </p>
            {latex.trim() ? <FormulaRender latex={latex} className="fb-formula-preview" /> : null}
          </div>
        ) : (
          <div
            className="fb-formula-display"
            title={editable ? "Click to edit the formula (Enter when selected)" : undefined}
            onClick={() => editable && setEditing(true)}
          >
            {latex.trim() ? <FormulaRender latex={latex} /> : <span className="fb-formula-empty">{editable ? "Empty formula — click to write LaTeX" : "Empty formula"}</span>}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
