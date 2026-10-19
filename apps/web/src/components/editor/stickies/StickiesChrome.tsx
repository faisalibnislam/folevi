"use client";

// The sticky notes board's floating controls (StickiesView.tsx): the bar for the chosen notes or groups,
// zoom, the vote and timer controls, and the panels (add several notes, tags). Neutral glass chrome; only
// the colour swatches carry colour. In the iPhone app a panel is one of the app's sheets.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleMinus, CirclePlus, Copy, LayoutGrid, ListTodo, Maximize, Minus, Pause, Pencil, Play, Plus, Tag, Timer, Trash2, X } from "lucide-react";
import { STICKY_COLORS, STICKY_COLOR_NAMES, STICKIES_LIMITS, stickyIdeasFromText, stickyTimerDone, stickyTimerLeft, type StickyColor, type StickyTimer } from "@folevi/editor-schema";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { Dialog } from "@/components/ui/Dialog";
import { useIphoneApp } from "@/lib/iphone";
import { haptic } from "@/lib/nativeApp";
import { ARRANGE_LABEL, type ArrangeKey } from "./ops";

/** A panel over the board, or a sheet in the iPhone app. */
export function Panel({ title, onClose, children, className = "", wide = false }: { title: string; onClose: () => void; children: ReactNode; className?: string; wide?: boolean }) {
  const iphone = useIphoneApp();
  if (iphone) {
    return (
      <Dialog open onClose={onClose} title={title} size={wide ? "lg" : "md"}>
        <div className="st-sheet">{children}</div>
      </Dialog>
    );
  }
  return (
    <div
      className={`st-panel ui-pop ${wide ? "st-panel-wide" : ""} ${className}`}
      role="dialog"
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="st-panel-head">
        <h3>{title}</h3>
        <button type="button" className="st-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}

/** Add several notes at once: one per line, or one per row of a pasted spreadsheet. */
export function BulkAddPanel({ onAdd, onClose, room }: { onAdd: (text: string) => void; onClose: () => void; room: number }) {
  const [text, setText] = useState("");
  const count = Math.min(room, stickyIdeasFromText(text, 200).length);
  return (
    <Panel title="Add several notes" onClose={onClose}>
      <form
        className="st-panel-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (count) onAdd(text);
        }}
      >
        <textarea
          className="st-input st-bulk"
          autoFocus
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && count) {
              e.preventDefault();
              onAdd(text);
            }
          }}
          aria-label="Ideas, one per line"
          placeholder={"One idea per line\nPaste a list or spreadsheet rows too"}
        />
        <p className="st-hint">Each line becomes a note. Start a line with [pink] for a colour and end it with #tags.</p>
        <div className="st-panel-actions">
          <button type="button" className="st-btn st-btn-text" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="st-btn st-btn-primary" disabled={!count}>
            {count === 1 ? "Add 1 note" : count ? `Add ${count} notes` : "Add notes"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/** Tags on the chosen notes: add one (Enter), take one off, or pick one already on the board. */
export function TagPanel({ tags, boardTags, onAdd, onRemove, onClose }: { tags: string[]; boardTags: string[]; onAdd: (tag: string) => void; onRemove: (tag: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const add = (t: string) => {
    const tag = t.replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, STICKIES_LIMITS.maxTagLength);
    if (tag) onAdd(tag);
    setText("");
  };
  const suggestions = boardTags.filter((t) => !tags.includes(t) && (!text || t.toLowerCase().includes(text.toLowerCase().replace(/^#/, "")))).slice(0, 8);
  return (
    <Panel title="Tags" onClose={onClose}>
      <div className="st-panel-body">
        {tags.length ? (
          <ul className="st-chips" aria-label="Tags on these notes">
            {tags.map((t) => (
              <li key={t}>
                <span className="st-chip">
                  #{t}
                  <button type="button" aria-label={`Remove the tag ${t}`} onClick={() => onRemove(t)}>
                    <X size={12} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="st-hint">No tags yet.</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
        >
          <input className="st-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={STICKIES_LIMITS.maxTagLength + 1} aria-label="New tag" placeholder="Add a tag and press Enter" />
        </form>
        {suggestions.length ? (
          <div className="st-chips" role="group" aria-label="Tags on the board">
            {suggestions.map((t) => (
              <button key={t} type="button" className="st-chip st-chip-btn" onClick={() => add(t)}>
                #{t}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** The bar for the chosen notes (colour, tags, votes, copies, tasks, delete) or groups. */
export function SelectionBar({
  style,
  notes,
  groups,
  color,
  myVotes,
  votesLeft,
  canVote,
  onColor,
  onTags,
  onVote,
  onUnvote,
  onDuplicate,
  onTasks,
  onRename,
  onTidyGroup,
  onDelete,
}: {
  style: React.CSSProperties;
  notes: number;
  groups: number;
  color: StickyColor | null;
  myVotes: number;
  votesLeft: number;
  canVote: boolean;
  onColor: (c: StickyColor) => void;
  onTags: () => void;
  onVote: () => void;
  onUnvote: () => void;
  onDuplicate: () => void;
  onTasks: () => void;
  onRename: () => void;
  onTidyGroup: () => void;
  onDelete: () => void;
}) {
  const label = notes && groups ? "Selected notes and groups" : notes ? (notes === 1 ? "Selected note" : `${notes} selected notes`) : groups === 1 ? "Selected group" : `${groups} selected groups`;
  return (
    <div className="st-bar st-bar-float" style={style} role="toolbar" aria-label={label} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {notes ? (
        <>
          <span role="group" aria-label="Colour" className="st-group-btns">
            {STICKY_COLORS.map((c) => (
              <button key={c} type="button" className="st-swatch" data-color={c} aria-label={STICKY_COLOR_NAMES[c]} title={STICKY_COLOR_NAMES[c]} aria-pressed={color === c} onClick={() => onColor(c)} />
            ))}
          </span>
          <span className="st-sep" aria-hidden />
          <button type="button" className="st-btn" aria-label="Tags" title="Tags" onClick={onTags}>
            <Tag size={15} aria-hidden />
          </button>
          {canVote ? (
            <>
              <button type="button" className="st-btn st-btn-text" aria-label={`Vote (${votesLeft} left)`} title={`Vote (${votesLeft} left)`} disabled={votesLeft < notes} onClick={onVote}>
                <CirclePlus size={15} aria-hidden />
                <span aria-hidden>{myVotes ? myVotes : ""}</span>
              </button>
              <button type="button" className="st-btn" aria-label="Take back a vote" title="Take back a vote" disabled={!myVotes} onClick={onUnvote}>
                <CircleMinus size={15} aria-hidden />
              </button>
            </>
          ) : null}
          <span className="st-sep" aria-hidden />
          <button type="button" className="st-btn" aria-label="Duplicate" title="Duplicate (⌘D)" onClick={onDuplicate}>
            <Copy size={15} aria-hidden />
          </button>
          <button type="button" className="st-btn" aria-label="Turn into to-dos in the note" title="Turn into to-dos in the note" onClick={onTasks}>
            <ListTodo size={15} aria-hidden />
          </button>
        </>
      ) : null}
      {!notes && groups === 1 ? (
        <>
          <button type="button" className="st-btn st-btn-text" onClick={onRename}>
            <Pencil size={14} aria-hidden /> Rename
          </button>
          <button type="button" className="st-btn st-btn-text" onClick={onTidyGroup}>
            <LayoutGrid size={14} aria-hidden /> Tidy
          </button>
        </>
      ) : null}
      <button type="button" className="st-btn" aria-label={notes ? "Delete" : "Delete group (keeps its notes)"} title={notes ? "Delete (⌫)" : "Delete group (keeps its notes)"} onClick={() => (haptic("warning"), onDelete())}>
        <Trash2 size={15} aria-hidden />
      </button>
    </div>
  );
}

export function ZoomBar({ zoom, onIn, onOut, onFit }: { zoom: number; onIn: () => void; onOut: () => void; onFit: () => void }) {
  return (
    <div className="st-bar st-bar-zoom" role="toolbar" aria-label="Zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className="st-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={onOut}>
        <Minus size={15} aria-hidden />
      </button>
      <span className="st-zoom">{Math.round(zoom * 100)}%</span>
      <button type="button" className="st-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={onIn}>
        <Plus size={15} aria-hidden />
      </button>
      <button type="button" className="st-btn" aria-label="Fit the board" title="Fit the board (⇧1)" onClick={onFit}>
        <Maximize size={14} aria-hidden />
      </button>
    </div>
  );
}

/** "Arrange" in the board's toolbar. */
export function ArrangeMenu({ onArrange, disabled }: { onArrange: (key: ArrangeKey) => void; disabled: boolean }) {
  const items: MenuEntry[] = [
    { label: ARRANGE_LABEL.tidy, description: "Line the notes up in their groups", onSelect: () => onArrange("tidy"), disabled },
    "separator",
    { heading: "Group by" },
    ...(["color", "tag", "author", "votes"] as const).map((k) => ({ label: ARRANGE_LABEL[k], onSelect: () => onArrange(k), disabled })),
  ];
  return <MenuButton label="Arrange" triggerClassName="fb-vc-btn" trigger={<LayoutGrid size={14} aria-hidden />} items={items} />;
}

/** "Votes" in the toolbar: how many you have left, how many each person gets, and clearing them. */
export function VotesMenu({ limit, used, total, onLimit, onClearMine, onClearAll }: { limit: number; used: number; total: number; onLimit: (n: number) => void; onClearMine: () => void; onClearAll: () => void }) {
  const left = Math.max(0, limit - used);
  const items: MenuEntry[] = [
    { heading: `${left} of ${limit} votes left` },
    ...[3, 5, 10].map((n) => ({ label: `${n} votes each`, checked: limit === n, onSelect: () => onLimit(n) })),
    "separator",
    { label: "Take back my votes", disabled: !used, onSelect: onClearMine },
    { label: "Clear all votes", danger: true, disabled: !total, onSelect: onClearAll },
  ];
  return (
    <MenuButton
      label={`Votes, ${left} of ${limit} left`}
      triggerClassName="fb-vc-btn"
      trigger={
        <span className="st-votes-trigger" aria-hidden>
          <span className="st-vote-dot" />
          {left}
        </span>
      }
      items={items}
    />
  );
}

const MINUTES = [1, 3, 5, 10, 15, 30];

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

const spoken = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return [m ? `${m} ${m === 1 ? "minute" : "minutes"}` : "", sec ? `${sec} ${sec === 1 ? "second" : "seconds"}` : ""].filter(Boolean).join(" ") || "0 seconds";
};

/** When a running timer runs out (epoch ms), or null when it isn't running. */
export const timerEnd = (timer: StickyTimer | undefined): number | null => (timer && timer.startedAt !== undefined ? timer.startedAt + timer.left : null);

/** The current time, ticking a few times a second until `until` (so a countdown never skips a second). */
export function useNow(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const tick = () => setNow(Date.now());
    tick();
    if (Date.now() >= until) return;
    const id = window.setInterval(() => {
      tick();
      if (Date.now() >= until) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [until]);
  return now;
}

/**
 * The workshop timer in the toolbar: a menu to start one, then the countdown everyone in the note sees (a
 * pill that pauses and resumes) with its own menu. Each viewer counts down on their own clock from the time
 * stored on the board; nothing runs on a server.
 */
export function TimerControl({ timer, onStart, onPause, onResume, onAdd, onStop }: { timer: StickyTimer | undefined; onStart: (minutes: number) => void; onPause: () => void; onResume: () => void; onAdd: () => void; onStop: () => void }) {
  const running = Boolean(timer && timer.startedAt !== undefined);
  const now = useNow(timerEnd(timer));
  const left = stickyTimerLeft(timer, now);
  const done = stickyTimerDone(timer, now);
  if (!timer) {
    return <MenuButton label="Timer" triggerClassName="fb-vc-btn" trigger={<Timer size={14} aria-hidden />} items={[{ heading: "Start a timer for everyone" }, ...MINUTES.map((m) => ({ label: m === 1 ? "1 minute" : `${m} minutes`, onSelect: () => onStart(m) }))]} />;
  }
  const progress = timer.total ? Math.min(1, Math.max(0, 1 - left / timer.total)) : 1;
  return (
    <span className="st-timer" data-done={done || undefined} data-paused={!running || undefined}>
      <button
        type="button"
        className="fb-vc-btn st-timer-pill"
        style={{ "--st-progress": progress } as React.CSSProperties}
        aria-label={done ? "Time's up. Stop the timer" : running ? `Timer, ${spoken(left)} left. Pause` : `Timer paused, ${spoken(left)} left. Resume`}
        title={done ? "Stop the timer" : running ? "Pause" : "Resume"}
        onClick={() => (done ? onStop() : running ? onPause() : onResume())}
      >
        {done ? <Timer size={14} aria-hidden /> : running ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
        <span className="st-timer-time">{done ? "Time's up" : clock(left)}</span>
      </button>
      <MenuButton
        label="Timer options"
        triggerClassName="fb-vc-btn st-timer-more"
        trigger={<span aria-hidden className="st-more-dots">···</span>}
        items={[
          { label: "Add a minute", onSelect: onAdd },
          ...MINUTES.slice(1, 4).map((m) => ({ label: `Restart at ${m} minutes`, onSelect: () => onStart(m) })),
          "separator",
          { label: "Stop timer", onSelect: onStop },
        ]}
      />
    </span>
  );
}

/** The gentle end of the timer, over the board: once per viewer, a soft tap in the iOS app. */
export function TimeUp({ timer, onAdd, onStop }: { timer: StickyTimer | undefined; onAdd: () => void; onStop: () => void }) {
  const now = useNow(timerEnd(timer));
  const done = stickyTimerDone(timer, now);
  const told = useRef<number | null>(null);
  useEffect(() => {
    if (done && timer?.startedAt !== undefined && told.current !== timer.startedAt) {
      told.current = timer.startedAt;
      haptic("success");
    }
  }, [done, timer?.startedAt]);
  if (!done) return null;
  return (
    <div className="st-timeup ui-pop" role="status" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <Timer size={16} aria-hidden className="st-timeup-icon" />
      <span>Time&apos;s up</span>
      <button type="button" className="st-btn st-btn-text" onClick={onAdd}>
        Add a minute
      </button>
      <button type="button" className="st-btn st-btn-text" onClick={onStop}>
        Done
      </button>
    </div>
  );
}
