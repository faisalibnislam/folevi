"use client";

// A shape's longer note: read in a small popover opened from the shape's note badge, written in the same
// popover (from the badge's Edit, the shape's bar or its right-click menu). Saved as one change when the
// popover closes; an emptied note is removed.
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { FLOWCHART_LIMITS } from "../schema";
import { FlowPanel } from "./FlowPanel";

export function NotePanel({
  note,
  editing: startEditing,
  editable,
  style,
  onSave,
  onClose,
}: {
  note: string;
  /** Opens straight into writing (otherwise it shows the note, with Edit). */
  editing: boolean;
  editable: boolean;
  style?: React.CSSProperties;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(startEditing || !note);
  const [draft, setDraft] = useState(note);
  const done = () => {
    if (draft !== note) onSave(draft);
    onClose();
  };
  return (
    <FlowPanel title="Note" onClose={editing ? done : onClose} className="fc-panel-note-pop" style={style}>
      {editing && editable ? (
        <>
          <textarea
            data-autofocus
            className="fc-note-input"
            aria-label="Note"
            placeholder="Write a note for this shape"
            value={draft}
            maxLength={FLOWCHART_LIMITS.maxNote}
            rows={5}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                done();
              }
            }}
          />
          <div className="fc-panel-actions">
            <span className="fc-panel-count" aria-live="polite">
              {draft.length > FLOWCHART_LIMITS.maxNote - 200 ? `${FLOWCHART_LIMITS.maxNote - draft.length} left` : ""}
            </span>
            {note ? (
              <button
                type="button"
                className="fc-btn fc-btn-text"
                onClick={() => {
                  onSave("");
                  onClose();
                }}
              >
                <Trash2 size={14} aria-hidden /> Remove
              </button>
            ) : null}
            <button type="button" className="fc-btn fc-btn-text fc-btn-primary" onClick={done} title="Done (⌘Enter)">
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="fc-note-text">{note}</p>
          {editable ? (
            <div className="fc-panel-actions">
              <button type="button" data-autofocus className="fc-btn fc-btn-text" onClick={() => setEditing(true)}>
                <Pencil size={14} aria-hidden /> Edit
              </button>
            </div>
          ) : null}
        </>
      )}
    </FlowPanel>
  );
}
