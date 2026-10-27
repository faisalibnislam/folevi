"use client";
// "Changed on another device · See the other version" (docs/LOCAL_MODE_PLAN.md owner decisions, §2.3, §3.4):
// the same block edited on two devices at once keeps the newer edit, and the other goes to version history
// with a notice. Here the notice sits under the block it's about (room is made under that block with a
// style rule, so the editor's own DOM is never touched), and opens version history at the other version.
// Dismissing it puts it away on every device. Notices about the title, a note that came back from a delete,
// or a block that's no longer on the page sit at the top of the note instead.
//
// NoteFrame wraps the editor in DocumentView: in account mode it's nothing; in local mode it adds the notices,
// and shows NotePlaceholder instead of the editor for a note that hasn't arrived yet.
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import { useBackendMode } from "@/lib/mode";
import { localApi, type NoteNotice } from "@/lib/local/localApi";
import { NotePlaceholder } from "./NotePlaceholder";

export function NoteFrame({ documentId, onOpenVersion, children }: { documentId: string; onOpenVersion: (versionId: string) => void; children: ReactNode }) {
  if (useBackendMode() !== "local") return <>{children}</>;
  return (
    <LocalNoteFrame documentId={documentId} onOpenVersion={onOpenVersion}>
      {children}
    </LocalNoteFrame>
  );
}

function LocalNoteFrame({ documentId, onOpenVersion, children }: { documentId: string; onOpenVersion: (versionId: string) => void; children: ReactNode }) {
  const status = useQuery(localApi.noteStatus, { documentId });
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [top, setTop] = useState<HTMLDivElement | null>(null);
  if (status?.pending) return <NotePlaceholder state={status.pending} />;
  return (
    <div ref={setBox} className="relative">
      <div ref={setTop} className="empty:hidden space-y-1.5 pb-3" />
      {children}
      {status?.notices.length ? <ChangedElsewhere documentId={documentId} notices={status.notices} container={box} top={top} onOpenVersion={onOpenVersion} /> : null}
    </div>
  );
}

const blockSelector = (id: string) => `[data-block-id="${CSS.escape(id)}"]`;

/** What a notice says, by what it's about and where it ended up. */
function words(n: NoteNotice, onPage: boolean): string {
  if (n.kind === "restored") return "This note was deleted on another device and came back because it changed here";
  if (n.field === "title") return "The title changed on another device";
  if (!onPage) return n.kind === "deleted" ? "A part of this note was deleted on another device while it changed here" : "A part of this note changed on another device";
  return n.kind === "deleted" ? "Deleted on another device, kept here" : "Changed on another device";
}

export function ChangedElsewhere({
  documentId,
  notices,
  container,
  top,
  onOpenVersion,
}: {
  documentId: string;
  notices: NoteNotice[];
  /** The frame the editor is in (position: relative): block notices are placed in it. */
  container: HTMLElement | null;
  /** Where the notices that aren't about a block on the page go (above the editor). */
  top: HTMLElement | null;
  onOpenVersion: (versionId: string) => void;
}) {
  const dismiss = useMutation(localApi.dismissNotice);
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  // One notice per block (or per title): merges seen in different orders can report the same clash twice
  // (docs/LOCAL_MODE_PLAN.md §3.10), so the newest speaks for all of them and dismissing it puts them all away.
  const groups = useMemo(() => {
    const by = new Map<string, NoteNotice[]>();
    for (const n of notices) {
      if (gone.has(n.id)) continue;
      const key = n.blockId ?? `${n.kind}:${n.field ?? ""}`;
      by.set(key, [...(by.get(key) ?? []), n]);
    }
    return by;
  }, [notices, gone]);
  const shown = useMemo(() => [...groups.values()].map((list) => list[list.length - 1]!), [groups]);
  // Where each block notice goes: under its block, measured in the frame (null: its block isn't on the page).
  const [tops, setTops] = useState<Map<string, number>>(() => new Map());

  const measure = useCallback(() => {
    if (!container) return;
    const frame = container.getBoundingClientRect();
    const next = new Map<string, number>();
    for (const n of shown) {
      if (!n.blockId) continue;
      const el = container.querySelector<HTMLElement>(blockSelector(n.blockId));
      if (el) next.set(n.id, Math.round(el.getBoundingClientRect().bottom - frame.top));
    }
    setTops((had) => (had.size === next.size && [...next].every(([k, v]) => had.get(k) === v) ? had : next));
  }, [container, shown]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    if (!container) return;
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(soon);
    resize.observe(container);
    const mutations = new MutationObserver(soon);
    mutations.observe(container, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", soon);
    };
  }, [container, measure]);

  const put = (n: NoteNotice) => {
    const all = groups.get(n.blockId ?? `${n.kind}:${n.field ?? ""}`) ?? [n];
    setGone((g) => new Set([...g, ...all.map((x) => x.id)]));
    for (const x of all)
      void dismiss({ documentId, noticeId: x.id }).catch(() =>
        setGone((g) => {
          const next = new Set(g);
          next.delete(x.id);
          return next;
        }),
      );
  };

  const onBlock = shown.filter((n) => tops.has(n.id));
  const atTop = shown.filter((n) => !tops.has(n.id));
  // Room under each block that has a notice, and a quiet mark on the block itself.
  const css = onBlock.map((n) => `${blockSelector(n.blockId!)}{margin-bottom:2.75rem!important;box-shadow:-0.75rem 0 0 -0.625rem var(--color-marigold)}`).join("\n");

  return (
    <>
      {css ? <style>{css}</style> : null}
      {top && atTop.length
        ? createPortal(
            atTop.map((n) => <Notice key={n.id} notice={n} text={words(n, false)} onOpen={onOpenVersion} onDismiss={() => put(n)} />),
            top,
          )
        : null}
      {onBlock.map((n) => (
        <div key={n.id} className="absolute inset-x-0" style={{ top: tops.get(n.id)! + 6 }}>
          <Notice notice={n} text={words(n, true)} onOpen={onOpenVersion} onDismiss={() => put(n)} />
        </div>
      ))}
    </>
  );
}

function Notice({ notice, text, onOpen, onDismiss }: { notice: NoteNotice; text: string; onOpen: (versionId: string) => void; onDismiss: () => void }) {
  // (Until a device has a name of its own the library calls it "This device"; that name isn't worth repeating.)
  const from = notice.otherDevice && notice.otherDevice !== "This device" && notice.otherDevice !== "Another device" ? notice.otherDevice : null;
  return (
    <div
      role="note"
      aria-label={text}
      data-testid="changed-elsewhere"
      data-block={notice.blockId ?? ""}
      className="flex min-h-8 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-control bg-[color-mix(in_oklab,var(--color-marigold)_14%,var(--color-surface))] py-1 pl-3 pr-1 text-subheadline text-ink shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-marigold)_30%,transparent)]"
    >
      <span className="min-w-0">
        {text}
        {from ? <span className="text-muted"> · {from}</span> : null}
      </span>
      <span className="ml-auto flex items-center gap-0.5">
        {notice.versionId ? (
          <button
            type="button"
            onClick={() => onOpen(notice.versionId!)}
            className="inline-flex h-7 items-center gap-1.5 rounded-chip px-2 font-medium text-heading outline-none hover:bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11"
          >
            <History size={13} aria-hidden /> See the other version
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="grid h-7 w-7 place-items-center rounded-chip text-muted outline-none hover:bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <X size={14} aria-hidden />
        </button>
      </span>
    </div>
  );
}
