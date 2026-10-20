"use client";

// Sticky notes block: a board of coloured notes in labelled group areas, for workshops and brainstorms (after
// Miro). The content lives in the block's `data` (packages/editor-schema/src/stickies.ts).
//
//   Pointer   click select · shift-click add · drag move (a group's label moves the group and its notes)
//             drag empty space to select an area · space-drag, middle-drag or scroll to pan · ⌘-scroll or
//             pinch to zoom · double-click to write on a note, or to add one · the corner handle resizes
//             · the vote dot votes (⌥-click takes a vote back) · Group area: drag out a labelled area
//   Touch     tap select · hold to add to the selection · drag to move · drag the board to pan · pinch to
//             zoom · double-tap to write or add a note (44 pt controls; panels are the app's sheets)
//   Keyboard  Tab through notes and groups · Enter write · Tab while writing adds the next note · arrows
//             nudge (⇧ more) · ⌫ delete · ⌘D duplicate · ⌘A select all · ⌘C copy as text · ⌘V paste a
//             list or spreadsheet rows (one note per line or row) · ⌘Z / ⇧⌘Z undo and redo · + / − zoom
//             · ⇧1 fit · ⇧⌘F full canvas · Esc back to the note
//
// The card, its toolbar, Full canvas, Export (./svg.ts) and the height handle are canvas/CanvasCard.tsx.
// Votes are per person (profile id), the timer is a start time and a duration everyone counts down from,
// and several people can work on the board at once (useStickiesDoc.ts merges their changes).
import type { ReactNodeViewProps } from "@tiptap/react";
import { useQuery } from "convex/react";
import { useCapabilities } from "@/lib/mode";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ListPlus, Redo2, SquareDashed, StickyNote, StickyNotes, Undo2 } from "lucide-react";
import {
  LIMITS,
  SCHEMA_VERSION,
  STICKIES_DEFAULT_HEIGHT,
  STICKIES_LIMITS,
  STICKY_SIZE,
  arrangeStickies,
  matchOwner,
  parseStickies,
  rankSequence,
  serializeStickies,
  stickyIdeasFromText,
  stickyTimerLeft,
  stickyVotesBy,
  voteOnSticky,
  type StickiesData,
  type StickyColor,
  type StickyIdea,
  type WireBlock,
} from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { haptic } from "@/lib/nativeApp";
import { useAiEnabled, useNoteAi } from "@/components/ai/useAi";
import { insertAiBlocks, insertAiMarkdown } from "@/components/ai/insert";
import { useToast } from "@/components/ui/Toast";
import { AiIcon } from "@/components/ai/AiIcon";
import { CanvasCard } from "../canvas/CanvasCard";
import type { FoldTool } from "../canvas/ToolFold";
import { useEditorEnvironment } from "../environment";
import { BoardLayer, type People, type View } from "./Board";
import { StickiesViewer, fitBoard } from "./render";
import { ArrangeMenu, BulkAddPanel, SelectionBar, TagPanel, TimeUp, TimerControl, VotesMenu, ZoomBar, arrangeItems, timerItems, votesItems, type TimerProps, type VotesProps } from "./StickiesChrome";
import { serverNow, useServerClock } from "./serverClock";
import { StickiesAi, type StickiesAiResult } from "./StickiesAi";
import {
  NO_SELECTION,
  addGroup,
  addIdeas,
  addTag,
  arrangeBy,
  boardTags,
  boxOf,
  deleteSelection,
  dragOrigin,
  duplicateNotes,
  moveItems,
  noteFontSize,
  notesInGroup,
  rectsOverlap,
  removeTag,
  resizeGroup,
  resizeNote,
  setColor,
  updateGroups,
  updateNotes,
  type Origin,
  type Pt,
  type Rect,
  type Selection,
} from "./ops";
import { useStickiesDoc } from "./useStickiesDoc";
import { targetUnder } from "../canvas/targetUnder";

const MIN_K = 0.15;
const MAX_K = 2.5;
const TOOLBAR = 52;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The people who can be in this note (for author marks and to-do owners), by profile id. */
function usePeople(documentId: string | undefined, skip: boolean) {
  const hasPeople = useCapabilities().comments;
  const list = useQuery(api.comments.mentionable, documentId && !skip && hasPeople ? { documentId } : "skip");
  return useMemo(() => {
    const people: Map<string, { name: string; isYou: boolean }> = new Map();
    for (const p of list ?? []) people.set(p.profileId, { name: p.displayName || "Someone", isYou: p.isYou });
    return { people: people as People, list: list ?? [] };
  }, [list]);
}

export function StickiesView(props: ReactNodeViewProps) {
  const { node, editor } = props;
  const data = String(node.attrs.data ?? "");
  const env = useEditorEnvironment();
  const noteAi = useNoteAi();
  const documentId = noteAi?.home?.id;
  const { profile } = useAppState();
  const me = env.demo ? "demo" : (profile?.id ?? "");
  const { people, list } = usePeople(documentId, env.demo);
  const board = useMemo(() => parseStickies(data), [data]);
  if (!editor.isEditable) {
    const empty = !board.notes.length && !board.groups.length;
    return (
      <CanvasCard view={props} type="stickies" name="Sticky notes" icon={<StickyNotes size={14} />} minHeight={LIMITS.minStickiesHeight} maxHeight={LIMITS.maxStickiesHeight} defaultHeight={STICKIES_DEFAULT_HEIGHT} empty={empty} hint="No notes on this board yet.">
        {empty ? null : <StickiesViewer board={board} fill people={people} me={me} top={TOOLBAR} />}
      </CanvasCard>
    );
  }
  return <StickiesEditor {...props} me={me} people={people} peopleList={list} documentId={documentId} demo={env.demo} />;
}

type Drag =
  | { kind: "pan"; pointer: number; sx: number; sy: number; view: View }
  | { kind: "move"; pointer: number; start: Pt; sx: number; sy: number; origin: Origin; before: StickiesData; moved: boolean; clicked: string | null; toggled: boolean; hold: number | null; touch: boolean }
  | { kind: "marquee"; pointer: number; start: Pt; base: Selection }
  | { kind: "draw"; pointer: number; start: Pt }
  | { kind: "resize"; pointer: number; start: Pt; id: string; group: boolean; w: number; h: number; before: StickiesData }
  | { kind: "pinch"; dist: number; view: View; mid: Pt };

/** Text being written on a note or a group's label. */
type Editing = { kind: "note" | "group"; id: string; before: StickiesData; typed?: boolean };

type PanelKind = "bulk" | "tags" | "ai" | null;

function StickiesEditor(props: ReactNodeViewProps & { me: string; people: People; peopleList: { profileId: string; displayName: string; isYou: boolean }[]; documentId?: string; demo: boolean }) {
  const { node, editor, getPos, updateAttributes, me, people, peopleList, documentId, demo } = props;
  const data = String(node.attrs.data ?? "");
  const blockId = typeof node.attrs.id === "string" ? node.attrs.id : null;
  const { engine } = useAppState();
  const write = useCallback((s: string) => updateAttributes({ data: s }), [updateAttributes]);
  const { doc, docRef, setLive, commit, undo, redo, canUndo, canRedo, tooLarge } = useStickiesDoc({ data, write, me, blockId, engine: demo ? null : engine });
  const aiOn = useAiEnabled() && !demo;
  // The workshop timer counts in server time: learn this device's offset from it once per session.
  useServerClock(!demo);
  const toast = useToast();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const selRef = useRef(sel);
  selRef.current = sel;
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [tool, setTool] = useState<"select" | "group">("select");
  const [panel, setPanel] = useState<PanelKind>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const frame = useRef<number | null>(null);
  const lastMove = useRef<PointerEvent | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number; id: string | null } | null>(null);
  const lastPointer = useRef("mouse");

  const nameOf = useCallback((id: string) => people.get(id)?.name ?? null, [people]);
  const canVote = Boolean(me);

  // ------------------------------------------------------------------------------ viewport

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback((b: StickiesData = docRef.current) => {
    const el = wrapRef.current;
    if (!el) return;
    setView(fitBoard(b, el.clientWidth, el.clientHeight, TOOLBAR, 40));
  }, [docRef]);

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !size.w) return;
    fitted.current = true;
    fitView();
  }, [size.w, fitView]);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  }, []);

  const zoomAt = useCallback((k: number, sx: number, sy: number) => {
    const v = viewRef.current;
    const nk = clamp(k, MIN_K, MAX_K);
    setView({ k: nk, x: sx - ((sx - v.x) / v.k) * nk, y: sy - ((sy - v.y) / v.k) * nk });
  }, []);
  const zoomBy = (f: number) => zoomAt(viewRef.current.k * f, size.w / 2, (size.h + TOOLBAR) / 2);

  const viewCenter = (): Pt => {
    const v = viewRef.current;
    return { x: (size.w / 2 - v.x) / v.k, y: ((size.h + TOOLBAR) / 2 - v.y) / v.k };
  };

  // Wheel: ⌘/ctrl (and a trackpad pinch) zooms; plain scrolling pans once the board is active, and
  // otherwise scrolls the page as usual.
  const active = useRef(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const body = el.closest<HTMLElement>(".fb-canvas-body");
    const onFocus = () => (active.current = true);
    const onBlur = (e: FocusEvent) => {
      if (!body?.contains(e.relatedTarget as Node | null)) {
        active.current = false;
        setSpaceDown(false);
      }
    };
    body?.addEventListener("focusin", onFocus);
    body?.addEventListener("focusout", onBlur);
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".st-panel, .st-bar")) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomAt(viewRef.current.k * Math.exp(-e.deltaY * unit * 0.0022), e.clientX - r.left, e.clientY - r.top);
      } else if (active.current) {
        e.preventDefault();
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView((v) => ({ ...v, x: v.x - dx * unit, y: v.y - dy * unit }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      body?.removeEventListener("focusin", onFocus);
      body?.removeEventListener("focusout", onBlur);
    };
  }, [zoomAt]);

  // ------------------------------------------------------------------------------ edits

  const bodyEl = () => wrapRef.current?.closest<HTMLElement>(".fb-canvas-body") ?? null;
  const focusBoard = () => {
    const a = document.activeElement;
    const body = bodyEl();
    // The board keeps the keyboard (a note or group that has it keeps it), never a toolbar button or a field.
    const onItem = a instanceof HTMLElement && wrapRef.current?.contains(a) && a.matches("[data-st-note], [data-st-group-label]");
    if (a !== body && !onItem) body?.focus({ preventScroll: true });
  };

  const startEdit = useCallback(
    (kind: "note" | "group", id: string, replaceWith?: string) => {
      const before = docRef.current;
      if (replaceWith !== undefined && kind === "note") setLive(updateNotes(before, [id], (n) => ({ ...n, text: replaceWith })));
      setEditing({ kind, id, before, typed: replaceWith !== undefined });
      setSel(kind === "note" ? { notes: [id], groups: [] } : { notes: [], groups: [id] });
    },
    [docRef, setLive],
  );

  /** Ends writing (one change); `refocus` returns the keyboard to the board. */
  const finishEdit = useCallback(
    (refocus = true) => {
      const ed = editingRef.current;
      if (!ed) return;
      editingRef.current = null;
      setEditing(null);
      if (docRef.current !== ed.before) commit(docRef.current, { before: ed.before });
      if (refocus) bodyEl()?.focus({ preventScroll: true });
    },
    [commit, docRef],
  );

  const addNotes = (ideas: StickyIdea[], at: Pt = viewCenter(), opts: { edit?: boolean; select?: boolean; color?: StickyColor } = {}) => {
    const room = STICKIES_LIMITS.maxNotes - docRef.current.notes.length;
    if (room <= 0) {
      toast.show(`A board holds up to ${STICKIES_LIMITS.maxNotes} notes.`);
      return [];
    }
    const res = addIdeas(docRef.current, ideas, at, me || undefined, opts.color);
    if (!res.ids.length) return [];
    commit(res.board);
    haptic("light");
    if (opts.select !== false) setSel({ notes: res.ids, groups: [] });
    if (opts.edit && res.ids.length === 1) setEditing({ kind: "note", id: res.ids[0]!, before: res.board });
    if (ideas.length > room) toast.show(`Added ${res.ids.length} notes. A board holds up to ${STICKIES_LIMITS.maxNotes}.`);
    // Bring them into view if they landed outside it.
    const box = boxOf(res.board.notes.filter((n) => res.ids.includes(n.id)));
    const v = viewRef.current;
    if (box && size.w) {
      const screen = { x: box.x * v.k + v.x, y: box.y * v.k + v.y, w: box.w * v.k, h: box.h * v.k };
      const inside = screen.x >= 0 && screen.y >= TOOLBAR && screen.x + screen.w <= size.w && screen.y + screen.h <= size.h;
      if (!inside) fitView(res.board);
    }
    if (!opts.edit) focusBoard();
    return res.ids;
  };

  /** One new note, centred on a point, to write on. */
  const addOne = (at?: Pt) => {
    const c = at ?? viewCenter();
    return addNotes([{ text: "" }], { x: c.x, y: c.y }, { edit: true });
  };

  const removeSelection = () => {
    const s = selRef.current;
    if (!s.notes.length && !s.groups.length) return;
    commit(deleteSelection(docRef.current, s));
    setSel(NO_SELECTION);
  };

  const duplicateSelection = () => {
    const s = selRef.current;
    if (!s.notes.length) return;
    const res = duplicateNotes(docRef.current, s.notes, me || undefined);
    commit(res.board);
    setSel({ notes: res.ids, groups: [] });
  };

  const vote = (ids: string[], delta: 1 | -1) => {
    if (!me) return;
    let b = docRef.current;
    for (const id of ids) {
      const next = voteOnSticky(b, id, me, delta);
      if (next === b && delta > 0) {
        toast.show(`You've used all ${b.voteLimit} of your votes. Take one back to vote again.`);
        break;
      }
      b = next;
    }
    if (b !== docRef.current) {
      commit(b, { key: "vote" });
      haptic("light");
    }
  };

  const arrange = (key: Parameters<typeof arrangeBy>[1]) => {
    const b = docRef.current;
    if (!b.notes.length) return;
    const next = arrangeBy(b, key, nameOf);
    commit(next);
    setSel(NO_SELECTION);
    fitView(next);
  };

  // To-dos in the note, under the board: the chosen notes' text as it is, or Foli AI's to-dos.
  const afterBoard = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return null;
    const n = editor.state.doc.nodeAt(pos);
    return n ? { pos: pos + n.nodeSize, depth: Number(n.attrs.depth ?? 0) } : null;
  };
  const insertTodos = (items: { text: string; owner?: string | null }[]) => {
    const at = afterBoard();
    if (!at || !items.length) return;
    const ranks = rankSequence(items.length);
    const blocks: WireBlock[] = items.map((t, i) => {
      const props: Record<string, unknown> = { checked: false };
      const owner = t.owner ? matchOwner(t.owner, peopleList) : null;
      if (owner?.assigneeId) props.assigneeId = owner.assigneeId;
      const text = `${t.owner && !owner?.assigneeId ? `${t.owner}: ` : ""}${t.text.replace(/\s+/g, " ").trim()}`.slice(0, LIMITS.maxTextLength);
      return { id: `todo-${i}`, type: "todo", parentId: null, rank: ranks[i]!, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props };
    });
    insertAiBlocks(editor, blocks, { kind: "after", ...at });
    toast.show(items.length === 1 ? "Added 1 to-do below the board" : `Added ${items.length} to-dos below the board`);
  };
  const notesToTodos = () => {
    const chosen = docRef.current.notes.filter((n) => selRef.current.notes.includes(n.id) && n.text.trim());
    if (!chosen.length) return toast.show("Write on a note first.");
    insertTodos(chosen.map((n) => ({ text: n.text })));
  };
  const insertMarkdown = (md: string) => {
    const at = afterBoard();
    if (at) insertAiMarkdown(editor, md, { kind: "after", ...at });
  };

  const applyAi = (r: StickiesAiResult) => {
    const b = docRef.current;
    if (r.kind === "cluster") {
      const next = arrangeStickies(b, r.groups.map((g) => ({ label: g.label, ids: g.ids })));
      commit(next);
      setSel(NO_SELECTION);
      fitView(next);
      toast.show(`Grouped into ${r.groups.length} ${r.groups.length === 1 ? "theme" : "themes"}. Undo with ⌘Z.`);
      setPanel(null);
    } else if (r.kind === "ideas" || r.kind === "photo") {
      const ids = addNotes(r.kind === "ideas" ? r.ideas : r.notes, viewCenter(), { select: true });
      if (ids.length) toast.show(r.kind === "ideas" ? `Added ${ids.length} ${ids.length === 1 ? "idea" : "ideas"} from Foli AI` : `Added ${ids.length} ${ids.length === 1 ? "note" : "notes"} from the photo`);
      setPanel(null);
    } else if (r.kind === "tasks") {
      insertTodos(r.tasks.map((t) => ({ text: t.text, owner: t.owner })));
      setPanel(null);
    }
  };

  // ------------------------------------------------------------------------------ the timer (shared)

  const setTimer = (next: StickiesData["timer"]) => {
    const b = docRef.current;
    const t: StickiesData = { ...b };
    if (next) t.timer = next;
    else delete t.timer;
    setLive(t, true);
  };
  // Start times are server times (serverClock.ts), so every viewer counts down to the same moment.
  const startTimer = (minutes: number) => setTimer({ total: minutes * 60_000, left: minutes * 60_000, startedAt: serverNow() });
  const pauseTimer = () => {
    const t = docRef.current.timer;
    if (t) setTimer({ total: t.total, left: stickyTimerLeft(t, serverNow()) });
  };
  const resumeTimer = () => {
    const t = docRef.current.timer;
    if (t) setTimer({ ...t, startedAt: serverNow() });
  };
  const addMinute = () => {
    const t = docRef.current.timer;
    if (!t) return;
    const now = serverNow();
    const left = stickyTimerLeft(t, now);
    setTimer({ total: Math.min(STICKIES_LIMITS.maxTimer, (left > 0 ? t.total : 0) + 60_000), left: Math.min(STICKIES_LIMITS.maxTimer, left + 60_000), startedAt: now });
  };

  // ------------------------------------------------------------------------------ paste and copy

  useEffect(() => {
    const body = wrapRef.current?.closest<HTMLElement>(".fb-canvas-body");
    if (!body) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const ideas = stickyIdeasFromText(text);
      if (!ideas.length) return;
      e.preventDefault();
      e.stopPropagation();
      addNotesRef.current(ideas);
    };
    const onCopy = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) return;
      const chosen = docRef.current.notes.filter((n) => selRef.current.notes.includes(n.id));
      if (!chosen.length) return;
      e.preventDefault();
      e.stopPropagation();
      e.clipboardData?.setData("text/plain", chosen.map((n) => n.text.replace(/\s*\n+\s*/g, " ").trim()).join("\n"));
    };
    body.addEventListener("paste", onPaste);
    body.addEventListener("copy", onCopy);
    return () => {
      body.removeEventListener("paste", onPaste);
      body.removeEventListener("copy", onCopy);
    };
  }, [docRef]);
  const addNotesRef = useRef(addNotes);
  addNotesRef.current = addNotes;

  // ------------------------------------------------------------------------------ pointer input

  const onFocusNote = useCallback((id: string) => {
    if (drag.current) return;
    if (!selRef.current.notes.includes(id)) setSel({ notes: [id], groups: [] });
  }, []);
  const onFocusGroup = useCallback((id: string) => {
    if (drag.current) return;
    if (!selRef.current.groups.includes(id)) setSel({ notes: [], groups: [id] });
  }, []);

  const process = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.kind === "pinch") return;
      if (d.kind === "pan") {
        setView({ ...d.view, x: d.view.x + (e.clientX - d.sx), y: d.view.y + (e.clientY - d.sy) });
        return;
      }
      const p = toWorld(e.clientX, e.clientY);
      if (d.kind === "move") {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < (d.touch ? 8 : 3)) return;
        if (!d.moved) {
          d.moved = true;
          if (d.hold !== null) window.clearTimeout(d.hold);
          if (d.touch) haptic("light");
        }
        setLive(moveItems(docRef.current, d.origin, p.x - d.start.x, p.y - d.start.y));
      } else if (d.kind === "marquee" || d.kind === "draw") {
        const r = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
        setMarquee(r);
        if (d.kind === "marquee") {
          const b = docRef.current;
          const notes = b.notes.filter((n) => rectsOverlap(n, r)).map((n) => n.id);
          const groups = b.groups.filter((g) => r.x <= g.x && r.y <= g.y && r.x + r.w >= g.x + g.w && r.y + r.h >= g.y + g.h).map((g) => g.id);
          setSel({ notes: [...new Set([...d.base.notes, ...notes])], groups: [...new Set([...d.base.groups, ...groups])] });
        }
      } else if (d.kind === "resize") {
        const w = d.w + (p.x - d.start.x);
        const h = d.h + (p.y - d.start.y);
        setLive(d.group ? updateGroups(docRef.current, [d.id], (g) => resizeGroup(g, w, h)) : updateNotes(docRef.current, [d.id], (n) => resizeNote(n, w, h)));
      }
    },
    [docRef, setLive, toWorld],
  );

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pts = pointers.current;
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const d = drag.current;
    if (d?.kind === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()].slice(0, 2) as [Pt, Pt] | [];
      if (!a || !b) return;
      const r = wrapRef.current!.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const k = clamp(d.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / d.dist), MIN_K, MAX_K);
      setView({ k, x: mid.x - ((d.mid.x - d.view.x) / d.view.k) * k, y: mid.y - ((d.mid.y - d.view.y) / d.view.k) * k });
      return;
    }
    if (!d || !("pointer" in d) || d.pointer !== e.pointerId) return;
    lastMove.current = e.nativeEvent;
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (lastMove.current) process(lastMove.current);
      });
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (target.closest(".st-text-input, .st-label-input")) return;
    lastPointer.current = e.pointerType;
    if (editingRef.current) finishEdit(false);
    if (panel === "tags") setPanel(null);
    focusBoard();
    const pts = pointers.current;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    // Two fingers: pinch to zoom (and pan), whatever the first finger was doing.
    if (pts.size === 2 && e.pointerType === "touch") {
      const cur = drag.current;
      if (cur?.kind === "move") {
        if (cur.hold !== null) window.clearTimeout(cur.hold);
        if (cur.moved) setLive(cur.before);
      }
      if (cur?.kind === "resize") setLive(cur.before);
      const [a, b] = [...pts.values()].slice(0, 2) as [Pt, Pt] | [];
      if (!a || !b) return;
      const r = wrapRef.current!.getBoundingClientRect();
      drag.current = { kind: "pinch", dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), view: viewRef.current, mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } };
      setMarquee(null);
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    const p = toWorld(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = docRef.current;
    const touch = e.pointerType !== "mouse";

    // The vote dot: a vote (⌥ or a right-side press takes one back).
    const voteEl = target.closest("[data-st-vote]");
    if (voteEl && !spaceDown) {
      const id = voteEl.getAttribute("data-st-vote")!;
      vote([id], e.altKey ? -1 : 1);
      drag.current = null;
      return;
    }
    const resizeEl = target.closest("[data-st-resize]");
    if (resizeEl) {
      const id = resizeEl.getAttribute("data-st-resize")!;
      const group = resizeEl.hasAttribute("data-group");
      const item = group ? b.groups.find((g) => g.id === id) : b.notes.find((n) => n.id === id);
      if (!item) return;
      drag.current = { kind: "resize", pointer: e.pointerId, start: p, id, group, w: item.w, h: item.h, before: b };
      return;
    }
    const noteEl = target.closest("[data-st-note]");
    const labelEl = target.closest("[data-st-group-label]");
    const onItem = !spaceDown && e.button !== 1 && (noteEl || labelEl);
    if (!onItem && (e.button === 1 || spaceDown || (touch && tool !== "group"))) {
      e.preventDefault();
      drag.current = { kind: "pan", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current };
      setPanning(true);
      return;
    }
    if (noteEl || labelEl) {
      const id = (noteEl ?? labelEl)!.getAttribute(noteEl ? "data-st-note" : "data-st-group-label")!;
      const kind = noteEl ? "notes" : "groups";
      const s = selRef.current;
      let next = s;
      let toggled = false;
      if (e.shiftKey || e.metaKey) {
        toggled = true;
        const list = s[kind].includes(id) ? s[kind].filter((x) => x !== id) : [...s[kind], id];
        next = { ...s, [kind]: list };
      } else if (!s[kind].includes(id)) {
        next = kind === "notes" ? { notes: [id], groups: [] } : { notes: [], groups: [id] };
      }
      setSel(next);
      // Holding a note (touch) adds it to the selection, or takes it out.
      const hold = touch
        ? window.setTimeout(() => {
            const d = drag.current;
            if (!d || d.kind !== "move" || d.moved) return;
            d.toggled = true;
            const cur = selRef.current;
            setSel({ ...cur, [kind]: cur[kind].includes(id) && cur[kind].length > 1 ? cur[kind].filter((x) => x !== id) : [...new Set([...cur[kind], id])] });
            haptic("medium");
          }, 480)
        : null;
      drag.current = { kind: "move", pointer: e.pointerId, start: p, sx: e.clientX, sy: e.clientY, origin: dragOrigin(b, next), before: b, moved: false, clicked: id, toggled, hold, touch };
      return;
    }
    if (tool === "group") {
      drag.current = { kind: "draw", pointer: e.pointerId, start: p };
      return;
    }
    // Empty board: select an area (adding to the selection with shift).
    const base = e.shiftKey || e.metaKey ? selRef.current : NO_SELECTION;
    if (!e.shiftKey && !e.metaKey) setSel(NO_SELECTION);
    drag.current = { kind: "marquee", pointer: e.pointerId, start: p, base };
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.kind === "pinch") {
      if (pointers.current.size < 2) drag.current = null;
      return;
    }
    if (!d || d.pointer !== e.pointerId) return;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      if (e.type !== "pointercancel") process(e.nativeEvent);
    }
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setPanning(false);
    setMarquee(null);
    if (d.kind === "move" && d.hold !== null) window.clearTimeout(d.hold);
    if (e.type === "pointercancel") {
      if ((d.kind === "move" && d.moved) || d.kind === "resize") setLive(d.before);
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (d.kind === "move") {
      if (d.moved) {
        commit(docRef.current, { before: d.before });
        if (d.touch) haptic("light");
      } else {
        if (!d.toggled && (selRef.current.notes.length + selRef.current.groups.length > 1)) setSel(selRef.current.notes.includes(d.clicked ?? "") ? { notes: [d.clicked!], groups: [] } : { notes: [], groups: [d.clicked!] });
        // A double tap writes on the note (or renames the group).
        if (d.touch && !d.toggled) tap(e, d.clicked);
      }
    } else if (d.kind === "resize") {
      if (docRef.current !== d.before) commit(docRef.current, { before: d.before });
    } else if (d.kind === "draw") {
      const r = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
      setTool("select");
      if (r.w < 24 || r.h < 24) return;
      const res = addGroup(docRef.current, r);
      if (!res) return toast.show(`A board holds up to ${STICKIES_LIMITS.maxGroups} groups.`);
      commit(res.board);
      setEditing({ kind: "group", id: res.id, before: res.board });
      setSel({ notes: [], groups: [res.id] });
    } else if (d.kind === "marquee") {
      if (e.pointerType !== "mouse") tap(e, null);
    } else if (d.kind === "pan") {
      if (e.pointerType !== "mouse" && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) tap(e, null);
    }
  };

  /** Two taps in a row on the same spot: like a double-click. */
  const tap = (e: React.PointerEvent, id: string | null) => {
    const now = Date.now();
    const last = lastTap.current;
    if (last && now - last.at < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 24 && last.id === id) {
      lastTap.current = null;
      doubleAt(e.clientX, e.clientY, e.target as Element);
      return;
    }
    lastTap.current = { at: now, x: e.clientX, y: e.clientY, id };
  };

  const doubleAt = (clientX: number, clientY: number, given: Element) => {
    // The board captures the pointer while it's down, so the event names the board, not what's under it.
    const target = document.elementFromPoint(clientX, clientY) ?? given;
    const noteEl = target.closest("[data-st-note]");
    if (noteEl) return startEdit("note", noteEl.getAttribute("data-st-note")!);
    const labelEl = target.closest("[data-st-group-label]");
    if (labelEl) return startEdit("group", labelEl.getAttribute("data-st-group-label")!);
    if (target.closest("[data-st-resize],[data-st-vote]")) return;
    addOne(toWorld(clientX, clientY));
  };

  // ------------------------------------------------------------------------------ keyboard

  const nudge = (dx: number, dy: number) => {
    const s = selRef.current;
    if (!s.notes.length && !s.groups.length) {
      setView((v) => ({ ...v, x: v.x - dx * 5, y: v.y - dy * 5 }));
      return;
    }
    const b = docRef.current;
    commit(moveItems(b, dragOrigin(b, s), dx, dy), { key: "nudge" });
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): boolean => {
    const t = e.target as HTMLElement;
    // Fields and panels keep their keys; the bars' buttons pass the board's shortcuts on (⌘Z after a colour).
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t.closest(".st-panel")) return false;
    if (t.closest(".st-bar") && (e.key === "Enter" || e.key === " ")) return false;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const s = selRef.current;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
      return true;
    };
    if (e.key === " " && !mod) {
      if (!spaceDown) setSpaceDown(true);
      return done();
    }
    if (mod && key === "z") {
      if (e.shiftKey) redo();
      else undo();
      return done();
    }
    if (mod && key === "y") {
      redo();
      return done();
    }
    if (mod && key === "d") {
      duplicateSelection();
      return done();
    }
    if (mod && key === "a") {
      setSel({ notes: docRef.current.notes.map((n) => n.id), groups: docRef.current.groups.map((g) => g.id) });
      return done();
    }
    if (mod) return false;
    if (e.key === "Delete" || e.key === "Backspace") {
      removeSelection();
      return done();
    }
    if (e.key === "Escape") {
      if (panel) setPanel(null);
      else if (tool !== "select") setTool("select");
      else if (s.notes.length || s.groups.length) setSel(NO_SELECTION);
      else return false;
      return done();
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[e.key];
    if (dir) {
      const step = e.shiftKey ? 40 : 8;
      nudge(dir[0] * step, dir[1] * step);
      return done();
    }
    if (e.key === "Enter") {
      if (s.notes.length === 1 && !s.groups.length) startEdit("note", s.notes[0]!);
      else if (s.groups.length === 1 && !s.notes.length) startEdit("group", s.groups[0]!);
      else if (!s.notes.length && !s.groups.length) addOne();
      return done();
    }
    if (e.key === "+" || e.key === "=") {
      zoomBy(1.2);
      return done();
    }
    if (e.key === "-" || e.key === "_") {
      zoomBy(1 / 1.2);
      return done();
    }
    if (e.key === "!" && e.shiftKey) {
      fitView();
      return done();
    }
    // Typing on a chosen note replaces its text.
    if (e.key.length === 1 && !e.altKey && s.notes.length === 1 && !s.groups.length) {
      startEdit("note", s.notes[0]!, e.key);
      return done();
    }
    return false;
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === " ") setSpaceDown(false);
  };

  // ------------------------------------------------------------------------------ writing

  const editNote = editing?.kind === "note" ? doc.notes.find((n) => n.id === editing.id) : undefined;
  const editGroup = editing?.kind === "group" ? doc.groups.find((g) => g.id === editing.id) : undefined;
  useEffect(() => {
    // What was being written on went away (someone deleted it, undo): stop writing.
    if (editing && !editNote && !editGroup) setEditing(null);
  }, [editing, editNote, editGroup]);

  // ⌘Z while writing: the fields are controlled, so the browser's own undo would reach the note's
  // contenteditable. Finish the writing as one step and use the board's history instead.
  const historyKey = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (!(e.metaKey || e.ctrlKey) || (key !== "z" && key !== "y")) return false;
    e.preventDefault();
    finishEdit();
    if (key === "y" || e.shiftKey) redo();
    else undo();
    return true;
  };

  let textEditor: React.ReactNode = null;
  if (editNote) {
    textEditor = (
      <textarea
        key={editNote.id}
        className="st-text-input"
        data-color={editNote.color}
        autoFocus
        value={editNote.text}
        maxLength={STICKIES_LIMITS.maxText}
        aria-label="Note text"
        style={{ left: editNote.x, top: editNote.y, width: editNote.w, height: editNote.h, fontSize: noteFontSize(editNote) }}
        onChange={(e) => {
          const id = editNote.id;
          setLive(updateNotes(docRef.current, [id], (n) => ({ ...n, text: e.target.value.slice(0, STICKIES_LIMITS.maxText) })));
        }}
        onFocus={(e) => {
          const el = e.currentTarget;
          el.setSelectionRange(el.value.length, el.value.length);
        }}
        onBlur={() => finishEdit(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (historyKey(e)) return;
          if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
            e.preventDefault();
            finishEdit();
          } else if (e.key === "Tab" && !e.shiftKey) {
            // The next idea: a new note beside this one.
            e.preventDefault();
            const n = editNote;
            finishEdit(false);
            addOne({ x: n.x + n.w + 24 + STICKY_SIZE / 2, y: n.y + n.h / 2 });
          }
        }}
      />
    );
  } else if (editGroup) {
    textEditor = (
      <input
        key={editGroup.id}
        className="st-label-input"
        autoFocus
        value={editGroup.label}
        maxLength={STICKIES_LIMITS.maxLabel}
        placeholder="Group name"
        aria-label="Group name"
        style={{ left: editGroup.x, top: editGroup.y, width: Math.max(160, editGroup.w) }}
        onChange={(e) => {
          const id = editGroup.id;
          setLive(updateGroups(docRef.current, [id], (g) => ({ ...g, label: e.target.value.replace(/\n+/g, " ").slice(0, STICKIES_LIMITS.maxLabel) })));
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => finishEdit(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (historyKey(e)) return;
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            finishEdit();
          }
        }}
      />
    );
  }

  // ------------------------------------------------------------------------------ overlays

  const selNotes = doc.notes.filter((n) => sel.notes.includes(n.id));
  const selGroups = doc.groups.filter((g) => sel.groups.includes(g.id));
  const k = view.k;
  const sBox = boxOf([...selNotes, ...selGroups]);
  const showBar = sBox && !drag.current && !editing && (selNotes.length || selGroups.length);
  const barStyle: React.CSSProperties | undefined = sBox
    ? (() => {
        const top = sBox.y * k + view.y;
        const bottom = (sBox.y + sBox.h) * k + view.y;
        // Kept whole inside the board (the bar is about 400 wide with every control).
        const half = Math.min(size.w / 2, 205);
        const cx = clamp((sBox.x + sBox.w / 2) * k + view.x, half, Math.max(half, size.w - half));
        // Above the selection, else under it, else at the top of the board (a selection filling the view).
        const y = top - 56 > TOOLBAR + 4 ? top - 56 : bottom + 12 + 44 < size.h - 52 ? bottom + 12 : TOOLBAR + 6;
        return { left: cx, top: y };
      })()
    : undefined;
  const same = <T,>(list: T[]): T | null => (list.length && list.every((x) => x === list[0]) ? list[0]! : null);
  const myVotesOn = me ? selNotes.reduce((a, n) => a + (n.votes[me] ?? 0), 0) : 0;
  const myUsed = me ? stickyVotesBy(doc, me) : 0;
  const totalVotes = doc.notes.reduce((a, n) => a + Object.values(n.votes).reduce((x, y) => x + y, 0), 0);
  const single = selNotes.length + selGroups.length === 1 && !editing ? (selNotes[0] ?? selGroups[0])! : null;
  const dot = 24 * k < 10 ? 48 * k : 24 * k;
  const count = doc.notes.length;
  const empty = !count && !doc.groups.length;
  const chosenTags = [...new Set(selNotes.flatMap((n) => n.tags))];

  const togglePanel = (p: Exclude<PanelKind, null>) => setPanel((cur) => (cur === p ? null : p));
  const votes: VotesProps = {
    limit: doc.voteLimit,
    used: myUsed,
    total: totalVotes,
    onLimit: (n) => commit({ ...docRef.current, voteLimit: n }),
    onClearMine: () => commit({ ...docRef.current, notes: docRef.current.notes.map((n) => (n.votes[me] ? { ...n, votes: Object.fromEntries(Object.entries(n.votes).filter(([w]) => w !== me)) } : n)) }),
    onClearAll: () => commit({ ...docRef.current, notes: docRef.current.notes.map((n) => (Object.keys(n.votes).length ? { ...n, votes: {} } : n)) }),
  };
  const timer: TimerProps = { timer: doc.timer, onStart: startTimer, onPause: pauseTimer, onResume: resumeTimer, onAdd: addMinute, onStop: () => setTimer(undefined) };
  // The toolbar; on a phone or a narrow card what doesn't fit folds into More, least used first (a running
  // timer stays, so its countdown is always in sight).
  const tools: FoldTool[] = [
    {
      key: "add",
      priority: 6,
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Add a note" title="Add a note (Enter, or double-click the board)" onClick={() => addOne()}>
          <StickyNote size={14} aria-hidden />
        </button>
      ),
      menu: [{ label: "Add a note", icon: <StickyNote size={14} aria-hidden />, onSelect: () => addOne() }],
    },
    {
      key: "bulk",
      priority: 2,
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Add several notes" title="Add several notes: one per line" aria-pressed={panel === "bulk"} onClick={() => togglePanel("bulk")}>
          <ListPlus size={15} aria-hidden />
        </button>
      ),
      menu: [{ label: "Add several notes", icon: <ListPlus size={14} aria-hidden />, onSelect: () => togglePanel("bulk") }],
    },
    {
      key: "group",
      priority: 1,
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Group area" title="Group area: drag out a labelled area" aria-pressed={tool === "group"} onClick={() => setTool((t) => (t === "group" ? "select" : "group"))}>
          <SquareDashed size={14} aria-hidden />
        </button>
      ),
      menu: [{ label: "Group area", icon: <SquareDashed size={14} aria-hidden />, checked: tool === "group", multi: true, onSelect: () => setTool((t) => (t === "group" ? "select" : "group")) }],
    },
    { key: "arrange", sep: true, priority: 1, node: <ArrangeMenu onArrange={arrange} disabled={!count} />, menu: arrangeItems(arrange, !count, true) },
    ...(canVote ? [{ key: "votes", priority: 2, node: <VotesMenu {...votes} />, menu: votesItems(votes) }] : []),
    { key: "timer", priority: doc.timer ? 7 : 0, node: <TimerControl {...timer} />, menu: timerItems(timer) },
    ...(aiOn
      ? [
          {
            key: "ai",
            priority: 3,
            node: (
              <button type="button" className="fb-vc-btn st-ai-btn" aria-label="Foli AI" title="Foli AI: group, summarise, ideas, photos, to-dos" aria-pressed={panel === "ai"} onClick={() => togglePanel("ai")}>
                <AiIcon size={14} className="st-ai-mark" />
              </button>
            ),
            menu: [{ label: "Foli AI", icon: <AiIcon size={14} className="st-ai-mark" />, onSelect: () => togglePanel("ai") }],
          },
        ]
      : []),
    {
      key: "undo",
      sep: true,
      priority: 5,
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={15} aria-hidden />
        </button>
      ),
      menu: [{ label: "Undo", icon: <Undo2 size={14} aria-hidden />, shortcut: "⌘Z", disabled: !canUndo, onSelect: undo }],
    },
    {
      key: "redo",
      priority: 4,
      node: (
        <button type="button" className="fb-vc-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={15} aria-hidden />
        </button>
      ),
      menu: [{ label: "Redo", icon: <Redo2 size={14} aria-hidden />, shortcut: "⇧⌘Z", disabled: !canRedo, onSelect: redo }],
    },
  ];

  // Escape closes an open panel from anywhere in the block (a toolbar button too); when the keyboard was in
  // the panel it goes back to the board, otherwise it stays where it is.
  const closePanel = () => {
    if (!panel) return false;
    const inPanel = document.activeElement instanceof Element && document.activeElement.closest(".st-panel");
    setPanel(null);
    if (inPanel) focusBoard();
    return true;
  };

  return (
    <CanvasCard
      view={props}
      type="stickies"
      name="Sticky notes"
      icon={<StickyNotes size={14} />}
      minHeight={LIMITS.minStickiesHeight}
      maxHeight={LIMITS.maxStickiesHeight}
      defaultHeight={STICKIES_DEFAULT_HEIGHT}
      empty={empty && !editing}
      hint="Double-click anywhere to add a note, or add several at once."
      tools={tools}
      onRefit={() => fitView()}
      onKey={onKey}
      onEscape={closePanel}
    >
      <div
        ref={wrapRef}
        className="st-canvas"
        data-native-menu=""
        data-panning={panning || undefined}
        data-space={spaceDown || undefined}
        data-tool={tool}
        role="application"
        aria-roledescription="sticky notes board"
        aria-label={`Sticky notes, ${count} ${count === 1 ? "note" : "notes"}`}
        aria-describedby={`${uid}-help`}
        onKeyUp={onKeyUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseDown={(e) => {
          if (!(e.target as Element).closest(".st-text-input, .st-label-input, .st-panel, .st-bar")) e.preventDefault();
        }}
        onDoubleClick={(e) => {
          // Fingers double-tap through `tap` (WebKit may also send a dblclick for them).
          if (lastPointer.current !== "mouse" || (e.target as Element).closest(".st-panel, .st-bar, .st-text-input, .st-label-input")) return;
          doubleAt(e.clientX, e.clientY, targetUnder(e));
        }}
        onContextMenu={(e) => {
          if ((e.target as Element).closest("[data-st-vote]")) {
            e.preventDefault();
            vote([(e.target as Element).closest("[data-st-vote]")!.getAttribute("data-st-vote")!], -1);
          }
        }}
      >
        <p id={`${uid}-help`} className="sr-only">
          Tab moves between notes. Enter writes on the chosen note, or adds one. Arrow keys move it, Delete removes it, Command D duplicates. Paste a list to add a note for each line. Command Z undoes. Escape returns to the note.
        </p>
        <div className="st-dots" aria-hidden style={{ backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${view.x % dot}px ${view.y % dot}px` }} />
        <BoardLayer board={doc} view={view} people={people} me={me || null} interactive selection={sel} editing={editing?.id ?? null} onFocusNote={onFocusNote} onFocusGroup={onFocusGroup}>
          {single && !drag.current ? <div className="st-resize" data-st-resize={single.id} data-group={"label" in single ? "" : undefined} aria-hidden style={{ left: single.x + single.w, top: single.y + single.h, transform: `translate(-50%, -50%) scale(${1 / k})` }} /> : null}
          {marquee ? <div className={tool === "group" ? "st-draw" : "st-marquee"} aria-hidden style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} /> : null}
          {textEditor}
        </BoardLayer>
        {empty && !editing ? (
          <div className="st-empty-actions" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <button type="button" className="st-btn st-btn-text st-empty-btn" onClick={() => addOne()}>
              <StickyNote size={14} aria-hidden /> Add a note
            </button>
            <button type="button" className="st-btn st-btn-text st-empty-btn" onClick={() => setPanel("bulk")}>
              <ListPlus size={15} aria-hidden /> Add several
            </button>
            {aiOn ? (
              <button type="button" className="st-btn st-btn-text st-empty-btn" onClick={() => setPanel("ai")}>
                <AiIcon size={14} className="st-ai-mark" /> Ideas or a photo with Foli AI
              </button>
            ) : null}
          </div>
        ) : null}
        <ZoomBar zoom={k} onIn={() => zoomBy(1.2)} onOut={() => zoomBy(1 / 1.2)} onFit={() => fitView()} />
        {showBar && barStyle ? (
          <SelectionBar
            style={barStyle}
            notes={selNotes.length}
            groups={selGroups.length}
            color={same(selNotes.map((n) => n.color))}
            myVotes={myVotesOn}
            votesLeft={Math.max(0, doc.voteLimit - myUsed)}
            canVote={canVote}
            onColor={(c) => commit(setColor(docRef.current, sel.notes, c))}
            onTags={() => setPanel("tags")}
            onVote={() => vote(sel.notes, 1)}
            onUnvote={() => vote(sel.notes.filter((id) => (docRef.current.notes.find((n) => n.id === id)?.votes[me] ?? 0) > 0), -1)}
            onDuplicate={duplicateSelection}
            onTasks={notesToTodos}
            onRename={() => selGroups[0] && startEdit("group", selGroups[0].id)}
            onTidyGroup={() => {
              const g = selGroups[0];
              if (!g) return;
              const ids = notesInGroup(docRef.current, g.id);
              if (!ids.length) return;
              const tidied = arrangeStickies({ ...docRef.current, groups: [] }, [{ label: g.label, ids }], { x: g.x, y: g.y });
              const placed = tidied.groups[0];
              const next = { ...docRef.current, notes: docRef.current.notes.map((n) => (ids.includes(n.id) ? tidied.notes.find((x) => x.id === n.id)! : n)), groups: docRef.current.groups.map((x) => (x.id === g.id && placed ? { ...x, w: Math.max(x.w, placed.w), h: Math.max(x.h, placed.h) } : x)) };
              commit(next);
            }}
            onDelete={removeSelection}
          />
        ) : null}
        <TimeUp timer={doc.timer} onAdd={addMinute} onStop={() => setTimer(undefined)} />
        {panel === "bulk" ? (
          <BulkAddPanel
            room={STICKIES_LIMITS.maxNotes - count}
            onClose={() => (setPanel(null), focusBoard())}
            onAdd={(text) => {
              setPanel(null);
              addNotes(stickyIdeasFromText(text));
            }}
          />
        ) : null}
        {panel === "tags" && selNotes.length ? (
          <TagPanel tags={chosenTags} boardTags={boardTags(doc)} onAdd={(t) => commit(addTag(docRef.current, sel.notes, t))} onRemove={(t) => commit(removeTag(docRef.current, sel.notes, t))} onClose={() => (setPanel(null), focusBoard())} />
        ) : null}
        {panel === "ai" && aiOn ? (
          <StickiesAi
            board={() => serializeStickies(docRef.current)}
            documentId={documentId}
            chosen={sel.notes}
            noteCount={doc.notes.filter((n) => n.text.trim()).length}
            onApply={applyAi}
            onInsertSummary={(s) => insertMarkdown(`**Board summary**\n\n${s}`)}
            onInsertWriteUp={(w) => insertMarkdown(`## ${w.title || "Board summary"}\n\n${w.summary}\n\n${w.nextSteps.length ? `### Next steps\n\n${w.nextSteps.map((s) => `- [ ] ${s}`).join("\n")}\n` : ""}`)}
            onClose={() => (setPanel(null), focusBoard())}
          />
        ) : null}
        {tooLarge ? (
          <p className="st-warning" role="alert">
            This board is too large to save. Remove some notes or text.
          </p>
        ) : null}
      </div>
    </CanvasCard>
  );
}
