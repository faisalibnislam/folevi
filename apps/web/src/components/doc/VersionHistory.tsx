"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Copy, MoreHorizontal, Pencil, RotateCcw } from "lucide-react";
import type { DocumentCover, DocumentStyle, WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useDocumentBlocks } from "@/lib/hooks/useEngine";
import { sheetProps } from "@/lib/cover";
import { diffVersions } from "@/lib/history/diff";
import { Button, IconButton } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Dialog } from "@/components/ui/Dialog";
import { MenuButton } from "@/components/ui/Menu";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ReadOnlyBlocks, type ChangePerson } from "./ReadOnlyBlocks";

type VersionList = FunctionReturnType<typeof api.documents.versions>;
type Version = VersionList["versions"][number];
type People = Record<string, ChangePerson>;

/** The page as it is now, at the top of the list (like the live document in Google Docs' history). */
const CURRENT = "current";

const REASONS: Partial<Record<string, string>> = { before_restore: "Before a restore", import: "Imported", ai_run: "Before AI changes" };

function dayLabel(ts: number, now = new Date()): string {
  const d = new Date(ts);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: days < 7 ? "long" : undefined, month: "long", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
const timeOf = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const whenOf = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A stored version, readable or not (saved by a newer Folevi, or gone). */
function parseVersion(content: string | null | undefined): { title: string; style?: DocumentStyle; blocks: WireBlock[] } | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as { title?: string; style?: DocumentStyle; blocks?: WireBlock[] };
    return Array.isArray(parsed.blocks) ? { title: parsed.title ?? "", style: parsed.style, blocks: parsed.blocks } : null;
  } catch {
    return null;
  }
}

/**
 * Version history over the whole window, as in Google Docs: the page as it was in the chosen version (with
 * what changed since the version before marked in the colour of whoever changed it) and the list of versions
 * beside it, newest first and grouped by day. Restore (undoable), name a version, or make a copy of it.
 */
export function VersionHistory(props: { open: boolean; onClose: () => void; documentId: string; title: string; style: DocumentStyle; cover: DocumentCover }) {
  if (!props.open) return null;
  return <HistoryView {...props} />;
}

function HistoryView({ onClose, documentId, title, style, cover }: { onClose: () => void; documentId: string; title: string; style: DocumentStyle; cover: DocumentCover }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);
  const { engine } = useAppState();
  const toast = useToast();
  const { navigate } = useAppRouter();
  const [namedOnly, setNamedOnly] = useState(false);
  const [selected, setSelected] = useState<string>(CURRENT);
  const [showChanges, setShowChanges] = useState(true);
  const [naming, setNaming] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  // Every version (for what each one is compared with), and the named ones when only those are listed.
  const all = useQuery(api.documents.versions, { documentId });
  const named = useQuery(api.documents.versions, namedOnly ? { documentId, namedOnly: true } : "skip");
  const listed = namedOnly ? named : all;
  // (A named version can be older than the newest ones `all` holds: it's looked up in the named list too.)
  const version = useMemo(
    () => (selected === CURRENT ? null : (all?.versions.find((v) => v.id === selected) ?? named?.versions.find((v) => v.id === selected) ?? null)),
    [selected, all, named],
  );
  // The version it's compared with: undefined until known, null for the first version.
  const previousId: string | null | undefined = selected === CURRENT ? (all ? (all.versions[0]?.id ?? null) : undefined) : version?.previousId;

  const chosen = useQuery(api.documents.snapshotContent, selected !== CURRENT ? { snapshotId: selected } : "skip");
  const before = useQuery(api.documents.snapshotContent, showChanges && previousId ? { snapshotId: previousId } : "skip");
  const live = useDocumentBlocks(engine, documentId);
  // Compared with the same version the list says comes before (a new one may have just been saved).
  const liveAuthors = useQuery(api.documents.blockAuthors, selected === CURRENT && previousId !== undefined ? { documentId, ...(previousId ? { since: previousId } : {}) } : "skip");

  const shown = useMemo(() => (selected === CURRENT ? { title, style, blocks: live } : parseVersion(chosen?.content)), [selected, title, style, live, chosen]);
  const unreadable = selected !== CURRENT && chosen !== undefined && !shown;
  // The version it's compared with: undefined while it loads, null when there's none (the first version).
  const earlier = useMemo(() => (previousId === undefined ? undefined : previousId ? (before === undefined ? undefined : (parseVersion(before?.content)?.blocks ?? null)) : null), [previousId, before]);
  const diff = useMemo(() => {
    if (!shown || !showChanges || earlier === undefined) return null;
    const authors = selected === CURRENT ? (liveAuthors?.authors ?? null) : (chosen?.authors ?? null);
    const removed = selected === CURRENT ? (liveAuthors?.removed ?? null) : (chosen?.removed ?? null);
    return diffVersions(earlier, shown.blocks, authors, removed);
  }, [shown, showChanges, earlier, selected, liveAuthors, chosen]);
  const people: People = useMemo(() => ({ ...all?.people, ...before?.people, ...chosen?.people, ...liveAuthors?.people }), [all, before, chosen, liveAuthors]);

  const fileIds = useMemo(() => [...new Set((diff?.blocks ?? shown?.blocks ?? []).map((b) => (b.props as { fileId?: unknown }).fileId).filter((x): x is string => typeof x === "string"))], [diff, shown]);
  const [now] = useState(() => Date.now());
  const files = useQuery(api.files.urls, fileIds.length ? { fileIds, now } : "skip");
  const fileUrls = useMemo(() => Object.fromEntries(Object.entries(files ?? {}).map(([id, f]) => [id, f.url])), [files]);

  const restore = useMutation(api.documents.restoreSnapshot);
  const nameVersion = useMutation(api.documents.nameVersion);
  const saveVersion = useMutation(api.documents.createSnapshot);
  const copyVersion = useMutation(api.documents.copyVersion);

  const doRestore = async (id: string, when: number, name: string | null) => {
    try {
      const { undoVersionId } = await restore({ snapshotId: id });
      onClose();
      toast.show(name ? `Restored “${name}”` : `Restored the version from ${whenOf(when)}`, {
        tone: "success",
        action: undoVersionId
          ? {
              label: "Undo",
              onClick: () => void restore({ snapshotId: undoVersionId }).then(() => toast.show("Restore undone"), (e) => toast.show(errorMessage(e), { tone: "error" })),
            }
          : undefined,
      });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };
  const doCopy = async (id: string) => {
    try {
      const copy = await copyVersion({ snapshotId: id });
      toast.show(`Saved a copy: ${copy.title}`, { action: { label: "Open", onClick: () => navigate(`/d/${copy.id}`) } });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };
  const doName = async (id: string, name: string) => {
    setNaming(null);
    try {
      if (id === CURRENT) {
        const r = await saveVersion({ documentId, reason: "manual", name });
        if (r.id) setSelected(r.id);
      } else await nameVersion({ snapshotId: id, name });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  const heading = selected === CURRENT ? "Current version" : version ? (version.name ?? whenOf(version.createdAt)) : "Version";
  const subheading = version ? (version.name ? whenOf(version.createdAt) : REASONS[version.reason]) : null;
  const sheet = sheetProps(shown?.style ?? style, cover);

  // ↑ / ↓ move through the list too (Tab works as well: each version is a button).
  const items = useMemo(() => [CURRENT, ...(listed?.versions ?? []).map((v) => v.id)], [listed]);
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only on the versions themselves: arrows in a version's menu (a portal, but React bubbles it here) move in the menu.
    if (naming || e.defaultPrevented || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    if (!(e.target instanceof HTMLElement) || !e.target.id.startsWith("version-")) return;
    e.preventDefault();
    const i = Math.max(0, items.indexOf(selected));
    const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]!;
    setSelected(next);
    document.getElementById(`version-${next}`)?.focus();
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Version history"
      onCancel={(e) => {
        // (Escape in the restore confirmation closes just that: its cancel event bubbles up here too.)
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (naming) setNaming(null);
        else onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-canvas p-0 text-ink backdrop:bg-transparent"
    >
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2.5 sm:px-4">
          <IconButton label="Back to the note" onClick={onClose}>
            <ArrowLeft size={18} aria-hidden />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-heading">{heading}</h1>
            {subheading ? <p className="truncate text-xs text-muted">{subheading}</p> : null}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <Switch checked={showChanges} onChange={setShowChanges} label="Show changes" />
            <span aria-hidden>Show changes</span>
          </label>
          {version ? (
            <Button variant="primary" onClick={() => setConfirmRestore(true)}>
              <RotateCcw size={14} aria-hidden /> Restore this version
            </Button>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <main className="fb-page min-h-0 min-w-0 flex-1 overflow-y-auto bg-[var(--color-surface-sunken)] px-3 py-6 sm:px-8" data-font={(shown?.style ?? style).font} data-width={(shown?.style ?? style).width}>
            {diff && diff.authors.length ? (
              <div role="group" className="mx-auto mb-3 flex max-w-[calc(var(--editor-width)+8rem)] flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Changes in this version by">
                <span>Changes by</span>
                {diff.authors.map((key) => (
                  <PersonChip key={key} person={people[key]} />
                ))}
              </div>
            ) : null}
            <article className="fb-sheet ui-sheet relative mx-auto px-6 pb-16 pt-10 sm:px-14" data-background={(shown?.style ?? style).background} {...sheet} style={{ ...sheet.style, maxWidth: "calc(var(--editor-width) + 8rem)" }}>
              {unreadable ? (
                <p role="alert" className="py-16 text-center text-sm text-muted">
                  This version can’t be shown. It may have been saved by a newer version of Folevi, or it’s no longer available.
                </p>
              ) : !shown ? (
                <div className="space-y-3 py-6" aria-busy aria-label="Loading version">
                  {[60, 95, 80, 88].map((w, i) => (
                    <div key={i} className="h-4 animate-pulse rounded bg-sunken motion-reduce:animate-none" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : (
                <>
                  <h2 className="ui-display mb-6 break-words text-[2.1rem] leading-tight text-heading">{shown.title || "Untitled"}</h2>
                  <ReadOnlyBlocks blocks={diff?.blocks ?? shown.blocks} fileUrls={fileUrls} changes={diff?.changes} people={people} />
                </>
              )}
            </article>
          </main>

          <aside className="flex max-h-[42vh] min-h-0 flex-col border-t border-line md:max-h-none md:w-[300px] md:border-l md:border-t-0" aria-label="Versions">
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
              <h2 className="text-sm font-semibold text-heading">Version history</h2>
              <div role="group" aria-label="Show" className="ui-seg bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)]">
                <button type="button" aria-pressed={!namedOnly} onClick={() => setNamedOnly(false)}>
                  All
                </button>
                <button type="button" aria-pressed={namedOnly} onClick={() => setNamedOnly(true)}>
                  Named
                </button>
              </div>
            </div>
            <div onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {!namedOnly ? (
                <VersionRow
                  id={CURRENT}
                  selected={selected === CURRENT}
                  onSelect={() => setSelected(CURRENT)}
                  title="Current version"
                  detail="The page as it is now"
                  editors={[]}
                  people={people}
                  naming={naming === CURRENT}
                  onName={(name) => void doName(CURRENT, name)}
                  onCancelName={() => setNaming(null)}
                  menu={[{ label: "Name current version", icon: <Pencil size={14} />, onSelect: () => setNaming(CURRENT) }]}
                />
              ) : null}
              {listed === undefined ? <p className="px-3 py-2 text-sm text-muted">Loading…</p> : null}
              {listed?.versions.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted">{namedOnly ? "No named versions yet. Name one from its menu." : "No versions yet. They’re saved as you edit."}</p>
              ) : null}
              {groupByDay(listed?.versions ?? []).map(([day, rows]) => (
                <section key={day} aria-label={day}>
                  <h3 className="ui-caps px-3 pb-1 pt-3" aria-hidden>
                    {day}
                  </h3>
                  {rows.map((v) => (
                    <VersionRow
                      key={v.id}
                      id={v.id}
                      selected={selected === v.id}
                      onSelect={() => setSelected(v.id)}
                      title={v.name ?? timeOf(v.createdAt)}
                      detail={v.name ? timeOf(v.createdAt) : REASONS[v.reason]}
                      editors={v.editors}
                      people={{ ...listed?.people, ...people }}
                      naming={naming === v.id}
                      currentName={v.name}
                      onName={(name) => void doName(v.id, name)}
                      onCancelName={() => setNaming(null)}
                      menu={[
                        { label: v.name ? "Rename version" : "Name this version", icon: <Pencil size={14} />, onSelect: () => setNaming(v.id) },
                        { label: "Restore this version", icon: <RotateCcw size={14} />, onSelect: () => (setSelected(v.id), setConfirmRestore(true)) },
                        { label: "Make a copy", icon: <Copy size={14} />, onSelect: () => void doCopy(v.id) },
                      ]}
                    />
                  ))}
                </section>
              ))}
            </div>
          </aside>
        </div>
      </div>

      <Dialog open={confirmRestore && Boolean(version)} onClose={() => setConfirmRestore(false)} title="Restore this version?" size="sm" description={version ? `The page goes back to how it was ${version.name ? `in “${version.name}”` : `on ${whenOf(version.createdAt)}`}. The way it is now is kept as a version first, so you can undo this.` : undefined}>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmRestore(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirmRestore(false);
              if (version) void doRestore(version.id, version.createdAt, version.name);
            }}
          >
            Restore
          </Button>
        </div>
      </Dialog>
    </dialog>
  );
}

function groupByDay(rows: Version[]): [string, Version[]][] {
  const groups: [string, Version[]][] = [];
  for (const v of rows) {
    const day = dayLabel(v.createdAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === day) last[1].push(v);
    else groups.push([day, [v]]);
  }
  return groups;
}

/** A person's picture (or initial), ringed in their colour: the colour their changes are marked in. */
function PersonAvatar({ person, size = 16 }: { person: ChangePerson | undefined; size?: number }) {
  return <Avatar name={person?.name ?? "Someone"} url={person?.avatarUrl} size={size} ring={`var(--color-${person?.color ?? "ink-muted"})`} />;
}

function PersonChip({ person }: { person: ChangePerson | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink">
      <PersonAvatar person={person} />
      {person?.name ?? "Someone"}
    </span>
  );
}

function VersionRow({
  id,
  selected,
  onSelect,
  title,
  detail,
  editors,
  people,
  naming,
  currentName,
  onName,
  onCancelName,
  menu,
}: {
  id: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail?: string | null;
  editors: string[];
  people: People;
  naming: boolean;
  currentName?: string | null;
  onName: (name: string) => void;
  onCancelName: () => void;
  menu: { label: string; icon: React.ReactNode; onSelect: () => void }[];
}) {
  const shown = editors.slice(0, 3);
  const more = editors.length - shown.length;
  return (
    <div className={`group relative mb-0.5 rounded-[8px] ${selected ? "bg-accent-soft" : "hover:bg-[var(--glass-hover)]"}`}>
      {naming ? (
        <form
          className="px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            onName(String(new FormData(e.currentTarget).get("name") ?? ""));
          }}
        >
          <input
            name="name"
            autoFocus
            defaultValue={currentName ?? ""}
            maxLength={80}
            placeholder="Name this version"
            aria-label="Version name"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancelName();
              }
            }}
            className="ui-input h-8 w-full rounded-[6px] px-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted">Enter to save, Esc to cancel. Named versions are kept for good.</p>
        </form>
      ) : (
        <button id={`version-${id}`} type="button" aria-current={selected ? "true" : undefined} onClick={onSelect} className="block w-full rounded-[8px] px-3 py-2 pr-10 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <span className={`block truncate text-sm ${selected ? "font-semibold text-heading" : "font-medium text-ink"}`}>{title}</span>
          {detail ? <span className="block truncate text-xs text-muted">{detail}</span> : null}
          {shown.length ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
              {shown.map((key) => (
                <span key={key} className="inline-flex items-center gap-1.5">
                  <PersonAvatar person={people[key]} size={18} />
                  {people[key]?.name ?? "Someone"}
                </span>
              ))}
              {more > 0 ? <span>+{more}</span> : null}
            </span>
          ) : null}
        </button>
      )}
      {!naming ? (
        <div className={`absolute right-1.5 top-1.5 ${selected ? "" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"}`}>
          <MenuButton label={`Options for ${title}`} trigger={<MoreHorizontal size={15} aria-hidden />} items={menu} />
        </div>
      ) : null}
    </div>
  );
}
