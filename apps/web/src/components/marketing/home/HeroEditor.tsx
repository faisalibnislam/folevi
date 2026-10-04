"use client";

import "@/components/editor/insert-blocks.css";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, MoreHorizontal, Share2, X } from "lucide-react";
import { localDate } from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { EditorMenus } from "@/components/editor/EditorMenus";
import { editorExtensions } from "@/components/editor/editorExtensions";
import { EditorEnvironmentProvider } from "@/components/editor/environment";
import { NotePaletteProvider } from "@/components/editor/notePalette";
import { moveSubtreeTo, subtreeRange } from "@/components/editor/commands";
import { clipboardBlocks, insertPastedBlocks, prepareForPaste } from "@/components/editor/paste";
import type { Slice } from "@tiptap/pm/model";
import { pasteAddress } from "@/components/editor/autolink";
import type { EditorView } from "@tiptap/pm/view";
import type { TriggerState } from "@/components/editor/plugins";
import { FormatPanel } from "@/components/doc/FormatPanel";
import { InsertPanel } from "@/components/doc/InsertPanel";
import type { InspectorTab } from "@/components/doc/Inspector";
import { PageDock } from "@/components/doc/PageDock";
import { IconButton } from "@/components/ui/Button";
import { ToastProvider } from "@/components/ui/Toast";
import { StaticAppStateProvider, type AppState, type Profile } from "@/lib/app/state";
import { StaticRouterProvider, type RouterValue } from "@/lib/app/router";
import { COVER_ART, type CoverArt } from "@/lib/cover";
import type { SyncEngine } from "@/lib/sync/engine";
import { MONTHLY_CREDITS } from "@/lib/plans";
import { SIGN_UP_URL } from "../site";
import { heroGlow } from "./heroStyles";
import { seedDoc } from "./heroNoteSeed";

/*
 * The home page note, editable: the app's own editor (its blocks, "/" menu, selection toolbar, to-dos, date
 * chips and keys) and its page tools dock (Insert, Format and Style work here), running with no account and
 * no server. Nothing is saved: a reload brings the starting note back. What needs an account (AI, sharing,
 * comments, sub-pages, uploads, links to other pages) asks the visitor to sign up instead.
 */

/**
 * The editor's menus are written against the app's server client. Here there is none: every query stays
 * "loading" and every call is refused, so nothing ever reaches the network.
 */
const noWatch = { onUpdate: () => () => undefined, localQueryResult: () => undefined, journal: () => undefined, localQueryLogs: () => undefined };
const refuse = () => Promise.reject(new Error("Sign up to use this."));
const OFFLINE_CLIENT = {
  watchQuery: () => noWatch,
  watchPaginatedQuery: () => noWatch,
  query: refuse,
  mutation: refuse,
  action: refuse,
  connectionState: () => ({ isWebSocketConnected: false, hasInflightRequests: false }),
} as unknown as ConvexReactClient;

function demoState(): AppState {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    profile: { id: "site-demo", displayName: "You", aiEnabled: false, entitlements: { ai: false, plan: "free" } } as unknown as Profile,
    workspaces: [],
    context: { kind: "personal" },
    scope: { kind: "personal" },
    scopeKey: "personal",
    workspace: null,
    role: "owner",
    canEdit: true,
    canManage: false,
    setContext: () => undefined,
    engine: null,
    uploader: null,
    deviceId: null,
    online: true,
    today: localDate(Date.now(), timeZone),
    timeZone,
    appearance: "system",
    setAppearance: () => undefined,
  };
}

const DEMO_ROUTER: RouterValue = { route: { name: "documents" }, pathname: "/", search: new URLSearchParams(), navigate: () => undefined, back: () => undefined };
/** The menus take the app's sync engine; nothing here reaches it (the demo environment asks to sign up first). */
const NO_ENGINE = {} as SyncEngine;
const DOC_ID = "site-demo-note";

type Notice = { title: string; body: ReactNode; items?: string[] };

const NOTICES: Record<"ai" | "comments" | "share" | "info" | "more", Notice> = {
  ai: {
    title: "AI Assistant",
    body: `Ask your notes a question, or let AI continue, summarize or tidy a page. Sign up to use it: the Free plan includes ${MONTHLY_CREDITS.free} AI credits a month.`,
    items: ["Ask AI…", "Continue writing", "Summarize note", "Find action items"],
  },
  comments: { title: "Comments", body: "Comment on any block and reply in threads. Sign up to comment on your own pages." },
  share: { title: "Share", body: "Share a page with a link or invite people by email. Links can expire or need a password. Sign up to share your own pages." },
  info: { title: "Info", body: "A page’s folder, tags, word count and version history live here. Sign up to see them for your own pages." },
  more: { title: "Page actions", body: "Duplicate, export as Markdown, HTML or PDF, move, archive and more. Sign up to use them on your own pages." },
};

export type HeroEditorProps = {
  /** The static body, shown until the editor is ready (same layout, so nothing moves). */
  staticBody: ReactNode;
  art: CoverArt;
  styles: readonly CoverArt[];
  onPickStyle: (index: number) => void;
  /** Where the dock goes: a sticky slot at the bottom of the note. */
  dockSlot: HTMLElement | null;
  /** Id of the text that says changes aren't saved. */
  describedBy: string;
  /** The editor is on screen (the page title becomes editable too). */
  onReady: (editor: Editor) => void;
};

export default function HeroEditor(props: HeroEditorProps) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [state] = useState(demoState);
  const env = useMemo(() => ({ demo: true, unavailable: (feature: string) => setNotice({ title: feature, body: `${feature} work in your own notes once you sign up. Nothing in this note is saved.` }) }), []);
  return (
    <ConvexProvider client={OFFLINE_CLIENT}>
      <StaticAppStateProvider value={state}>
        <StaticRouterProvider value={DEMO_ROUTER}>
          <ToastProvider>
            <EditorEnvironmentProvider value={env}>
              <NotePaletteProvider colors={props.art} active>
                <DemoNote {...props} notice={notice} setNotice={setNotice} />
              </NotePaletteProvider>
            </EditorEnvironmentProvider>
          </ToastProvider>
        </StaticRouterProvider>
      </StaticAppStateProvider>
    </ConvexProvider>
  );
}

function DemoNote({ staticBody, art, styles, onPickStyle, dockSlot, describedBy, onReady, notice, setNotice }: HeroEditorProps & { notice: Notice | null; setNotice: (n: Notice | null) => void }) {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [ready, setReady] = useState(false);
  const aiHint = useRef(false);
  const extensions = useMemo(() => editorExtensions({ aiHint, onTrigger: setTrigger }), []);
  // One set of options for the editor's lifetime: new options on a re-render (a style change) would be
  // applied to the live editor and could reset its selection.
  const options = useMemo(
    () => ({
      extensions,
      immediatelyRender: false,
      content: seedDoc(),
      editorProps: {
        attributes: {
          class: "fb-editor mk-hero-editor",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": "Try the editor",
          "aria-describedby": describedBy,
          spellcheck: "true",
        },
        // Pasting works as in the app: Markdown, web pages and several lines become blocks.
        handlePaste: (view: EditorView, event: ClipboardEvent, slice: Slice) => {
          prepareForPaste(view, slice);
          if (pasteAddress(view, event.clipboardData)) {
            event.preventDefault();
            return true;
          }
          const blocks = clipboardBlocks(view, event.clipboardData);
          if (!blocks) return false;
          event.preventDefault();
          insertPastedBlocks(view, blocks);
          return true;
        },
      },
      onCreate: () => setReady(true),
    }),
    [extensions, describedBy],
  );
  const editor = useEditor(options);
  useEffect(() => {
    if (editor && ready) onReady(editor);
  }, [editor, ready, onReady]);

  // Block drag and drop (the grip in the menus runs the pointer drag; this applies the move), as in the app.
  const onDropBlock = useCallback(
    (fromIndex: number, toIndex: number, depth: number) => {
      if (!editor) return null;
      const count = subtreeRange(editor.state, fromIndex).count;
      const moved = moveSubtreeTo(editor.state, fromIndex, toIndex, depth);
      if (!moved) return null;
      editor.view.dispatch(closeHistory(moved.tr).scrollIntoView());
      return { index: moved.index, count };
    },
    [editor],
  );

  return (
    <>
      {ready ? null : staticBody}
      <div className="relative" data-fb-root={DOC_ID} style={ready ? undefined : { position: "absolute", inset: 0, visibility: "hidden" }}>
        <EditorContent editor={editor} />
        {editor && ready ? (
          <EditorMenus
            editor={editor}
            documentId={DOC_ID}
            engine={NO_ENGINE}
            trigger={trigger}
            editable
            onInsertFiles={async () => setNotice({ title: "Files", body: "Files and images work in your own notes once you sign up. Nothing in this note is saved." })}
            onInsertAudio={async () => setNotice({ title: "Audio recordings", body: "Audio recordings work in your own notes once you sign up. Nothing in this note is saved." })}
            onDropBlock={onDropBlock}
            onCommentBlock={() => setNotice(NOTICES.comments)}
          />
        ) : null}
      </div>
      {dockSlot && editor && ready ? createPortal(<DemoDock editor={editor} art={art} styles={styles} onPickStyle={onPickStyle} notice={notice} setNotice={setNotice} />, dockSlot) : null}
    </>
  );
}

type Open = { kind: "panel"; tab: InspectorTab } | { kind: "notice" } | null;

/** The page tools dock at the bottom of the note, with its panels floating above it (as in the app). */
function DemoDock({ editor, art, styles, onPickStyle, notice, setNotice }: { editor: Editor; art: CoverArt; styles: readonly CoverArt[]; onPickStyle: (i: number) => void; notice: Notice | null; setNotice: (n: Notice | null) => void }) {
  const [open, setOpen] = useState<Open>(null);
  const buttons = useRef<Partial<Record<InspectorTab, HTMLButtonElement | null>>>({});
  const extraButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // A notice from the editor (a feature that needs an account) opens in the same place as the panels.
  useEffect(() => {
    if (notice) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen({ kind: "notice" });
    }
  }, [notice]);

  const close = useCallback(() => {
    setOpen(null);
    setNotice(null);
    requestAnimationFrame(() => {
      const back = opener.current;
      if (back?.isConnected && !panelRef.current?.contains(back)) back.focus();
    });
  }, [setNotice]);

  // Focus moves into a panel when it opens; Escape closes it and returns focus to what opened it.
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button, a[href], input, select")?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen, open]);

  const pick = (t: InspectorTab) => {
    if (open?.kind === "panel" && open.tab === t) return close();
    opener.current = buttons.current[t] ?? null;
    if (t === "ai" || t === "info") {
      setNotice(NOTICES[t]);
      return;
    }
    setNotice(null);
    setOpen({ kind: "panel", tab: t });
  };
  const extra = (key: "comments" | "share" | "more") => {
    opener.current = extraButtons.current[key] ?? null;
    setNotice(NOTICES[key]);
  };
  const panelTitle = open?.kind === "panel" ? { insert: "Insert", format: "Format", style: "Style" }[open.tab as "insert" | "format" | "style"] : notice?.title;
  const extraClass = "!h-10 !w-10 !text-ink hover:!text-heading";

  return (
    <div className="mk-hero-dock">
      <PageDock
        tab={open?.kind === "panel" ? open.tab : "format"}
        open={open?.kind === "panel"}
        onPick={pick}
        buttonRef={(t, el) => {
          buttons.current[t] = el;
        }}
        extra={
          <div role="group" aria-label="Page" className="flex items-center gap-0.5">
            <IconButton ref={(el) => void (extraButtons.current.comments = el)} label="Comments" onClick={() => extra("comments")} className={`${extraClass} max-sm:!hidden`}>
              <MessageSquare size={16} aria-hidden />
            </IconButton>
            <IconButton ref={(el) => void (extraButtons.current.share = el)} label="Share" onClick={() => extra("share")} className={extraClass}>
              <Share2 size={16} aria-hidden />
            </IconButton>
            <IconButton ref={(el) => void (extraButtons.current.more = el)} label="Document actions" onClick={() => extra("more")} className={extraClass}>
              <MoreHorizontal size={16} aria-hidden />
            </IconButton>
          </div>
        }
      />
      {open ? (
        <div
          ref={panelRef}
          id="document-inspector"
          role="dialog"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.defaultPrevented) {
              e.preventDefault();
              close();
            }
          }}
          className="mk-hero-panel ui-pop flex flex-col overflow-hidden rounded-[14px] animate-[folio-rise_180ms_var(--ease-folio)] motion-reduce:animate-none"
        >
          <div className="flex h-12 flex-none items-center gap-1 px-4 pt-1">
            <h2 id={titleId} className="ui-display flex-1 text-[18px]">
              {panelTitle}
            </h2>
            <IconButton label="Close" onClick={close} className="!h-7 !w-7">
              <X size={15} aria-hidden />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
            {open.kind === "panel" && open.tab === "insert" ? <InsertPanel editor={editor} disabled={false} /> : null}
            {open.kind === "panel" && open.tab === "format" ? <FormatPanel editor={editor} disabled={false} /> : null}
            {open.kind === "panel" && open.tab === "style" ? <StylePanel art={art} styles={styles} onPick={onPickStyle} /> : null}
            {open.kind === "notice" && notice ? <NoticeBody notice={notice} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The Style panel's note styles: the ones the home page offers, picked the way the app picks them. */
function StylePanel({ art, styles, onPick }: { art: CoverArt; styles: readonly CoverArt[]; onPick: (i: number) => void }) {
  const labelId = useId();
  return (
    <div className="px-1">
      <p id={labelId} className="ui-caps">
        Note style
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="mt-2 grid grid-cols-5 gap-2">
        {styles.map((s, i) => {
          const on = s.id === art.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`Note style: ${s.name}`}
              onClick={() => onPick(i)}
              className={`aspect-square rounded-[8px] bg-cover bg-center outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-focus ${on ? "shadow-[0_0_0_2px_var(--color-surface-raised),0_0_0_4px_var(--color-heading)]" : "shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] hover:shadow-[0_0_0_2px_var(--color-surface-raised),0_0_0_4px_var(--color-line-strong)]"}`}
              style={{ backgroundImage: `url("${heroGlow(s)}")` }}
            />
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-muted">
        {art.name}. The style colours the cover, the paper, the text and the checkboxes. Your own notes have {COVER_ART.length} styles, or a picture of your own.
      </p>
    </div>
  );
}

function NoticeBody({ notice }: { notice: Notice }) {
  return (
    <div className="px-1">
      <p className="text-[14px] leading-relaxed text-ink">{notice.body}</p>
      {notice.items ? (
        <ul className="mt-3 space-y-0.5" aria-label="Not available here">
          {notice.items.map((item) => (
            <li key={item} aria-disabled="true" className="flex h-8 items-center gap-2 rounded-[6px] px-2 text-[13.5px] text-muted">
              <AiIcon size={14} />
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      <a href={SIGN_UP_URL} className="ui-btn ui-btn-primary mt-4 h-9 w-full px-4 text-[14px]">
        Sign up free
      </a>
    </div>
  );
}
