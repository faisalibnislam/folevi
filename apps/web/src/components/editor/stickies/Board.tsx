"use client";

// The sticky notes board drawn in the page (the editor in StickiesView.tsx and the read-only viewer in
// render.tsx): group areas, then notes, inside one world layer that pans and zooms with a CSS transform.
// Notes are paper-coloured from the design tokens (stickies.css), so they read in light and dark. Each
// note shows who wrote it (initials), its tags and its dot votes (the total, highlighted when some are
// yours). Hit-testing is by data attributes (data-st-note, data-st-group, …), so this stays a drawing.
import { memo } from "react";
import { STICKY_COLOR_NAMES, stickyVoteCount, type StickiesData, type Sticky, type StickyGroup } from "@folevi/editor-schema";
import { initials, noteFontSize } from "./ops";

export interface View {
  x: number;
  y: number;
  k: number;
}

/** Who someone is, for a note's author mark (from the people in the note's place). */
export interface Person {
  name: string;
  isYou: boolean;
}

export type People = ReadonlyMap<string, Person>;

/** How a note reads out: its text, colour, who wrote it, tags and votes. */
export function noteLabel(n: Sticky, people: People, me: string | null): string {
  const votes = stickyVoteCount(n);
  const mine = me ? (n.votes[me] ?? 0) : 0;
  const who = n.author ? people.get(n.author) : undefined;
  const parts = [n.text.trim() || "Empty note", `${STICKY_COLOR_NAMES[n.color].toLowerCase()} note`];
  if (who) parts.push(`by ${who.isYou ? "you" : who.name}`);
  if (n.tags.length) parts.push(`tagged ${n.tags.join(", ")}`);
  if (votes) parts.push(`${votes} ${votes === 1 ? "vote" : "votes"}${mine ? `, ${mine} yours` : ""}`);
  return parts.join(", ");
}

export const NoteItem = memo(function NoteItem({
  note,
  selected,
  editing,
  people,
  me,
  interactive,
  onFocusNote,
  position,
}: {
  note: Sticky;
  selected: boolean;
  editing: boolean;
  people: People;
  me: string | null;
  interactive: boolean;
  onFocusNote?: (id: string) => void;
  position?: string;
}) {
  const votes = stickyVoteCount(note);
  const mine = me ? (note.votes[me] ?? 0) : 0;
  const who = note.author ? people.get(note.author) : undefined;
  const a11y = interactive
    ? { tabIndex: 0, role: "button" as const, "aria-pressed": selected, "aria-label": `${noteLabel(note, people, me)}${position ? `, ${position}` : ""}`, onFocus: () => onFocusNote?.(note.id) }
    : { "aria-hidden": true as const };
  return (
    <div
      className="st-note"
      data-st-note={note.id}
      data-color={note.color}
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      style={{ left: note.x, top: note.y, width: note.w, height: note.h }}
      {...a11y}
    >
      <div className="st-note-text" style={{ fontSize: noteFontSize(note), visibility: editing ? "hidden" : undefined }}>
        {note.text.trim() ? note.text : <span className="st-note-empty">{interactive ? "Empty note" : ""}</span>}
      </div>
      {who || note.tags.length || votes || interactive ? (
        <div className="st-note-foot">
          {who ? (
            <span className="st-author" title={who.isYou ? `${who.name} (you)` : who.name} aria-hidden>
              {initials(who.name)}
            </span>
          ) : null}
          {note.tags.length ? (
            <span className="st-tags" aria-hidden>
              {note.tags.slice(0, 3).map((t) => (
                <span key={t} className="st-tag">
                  #{t}
                </span>
              ))}
            </span>
          ) : (
            <span className="st-tags" />
          )}
          {votes || (interactive && me) ? (
            <span className="st-vote" data-st-vote={interactive ? note.id : undefined} data-mine={mine || undefined} data-empty={!votes || undefined} title={interactive ? `${votes ? `${votes} ${votes === 1 ? "vote" : "votes"}${mine ? `, ${mine} yours` : ""}. ` : ""}Click to vote, ⌥-click to take a vote back` : undefined} aria-hidden>
              <span className="st-vote-dot" />
              {votes ? votes : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export const GroupItem = memo(function GroupItem({
  group,
  count,
  selected,
  editing,
  interactive,
  onFocusGroup,
}: {
  group: StickyGroup;
  count: number;
  selected: boolean;
  editing: boolean;
  interactive: boolean;
  onFocusGroup?: (id: string) => void;
}) {
  const label = group.label.trim() || "Untitled group";
  return (
    <div className="st-group" data-st-group={group.id} data-selected={selected || undefined} style={{ left: group.x, top: group.y, width: group.w, height: group.h }} aria-hidden={interactive ? undefined : true}>
      <div
        className="st-group-label"
        data-st-group-label={group.id}
        data-untitled={!group.label.trim() || undefined}
        style={{ visibility: editing ? "hidden" : undefined }}
        {...(interactive ? { tabIndex: 0, role: "button", "aria-pressed": selected, "aria-label": `Group: ${label}, ${count} ${count === 1 ? "note" : "notes"}`, onFocus: () => onFocusGroup?.(group.id) } : {})}
      >
        {label}
      </div>
    </div>
  );
});

/** The board's notes and groups at a view (pan and zoom), without any editing chrome. */
export function BoardLayer({
  board,
  view,
  people,
  me,
  interactive = false,
  selection,
  editing,
  onFocusNote,
  onFocusGroup,
  children,
}: {
  board: StickiesData;
  view: View;
  people: People;
  me: string | null;
  interactive?: boolean;
  selection?: { notes: readonly string[]; groups: readonly string[] };
  editing?: string | null;
  onFocusNote?: (id: string) => void;
  onFocusGroup?: (id: string) => void;
  children?: React.ReactNode;
}) {
  const counts = new Map<string, number>();
  if (board.groups.length) {
    for (const n of board.notes) {
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      let best: StickyGroup | null = null;
      for (const g of board.groups) if (cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h && (!best || g.w * g.h < best.w * best.h)) best = g;
      if (best) counts.set(best.id, (counts.get(best.id) ?? 0) + 1);
    }
  }
  const total = board.notes.length;
  return (
    <div className="st-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
      <div className="st-groups">
        {board.groups.map((g) => (
          <GroupItem key={g.id} group={g} count={counts.get(g.id) ?? 0} selected={selection?.groups.includes(g.id) ?? false} editing={editing === g.id} interactive={interactive} onFocusGroup={onFocusGroup} />
        ))}
      </div>
      <div className="st-notes">
        {board.notes.map((n, i) => (
          <NoteItem key={n.id} note={n} selected={selection?.notes.includes(n.id) ?? false} editing={editing === n.id} people={people} me={me} interactive={interactive} onFocusNote={onFocusNote} position={interactive ? `note ${i + 1} of ${total}` : undefined} />
        ))}
      </div>
      {children}
    </div>
  );
}
