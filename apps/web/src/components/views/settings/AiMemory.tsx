"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { api } from "@/lib/convex/api";
import type { Id } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIphoneLook } from "@/lib/iphone";
import { ActionRow, ChoiceRow, DestructiveRow, EditRow, IosRow, IosSection, IosText, Subscreen, TextRow, useSettingsScreens } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { Brain } from "lucide-react";

type Memory = FunctionReturnType<typeof api.aiMemory.list>;
export type MemoryItem = Memory["items"][number];
export type MemoryKind = MemoryItem["kind"];

export const MEMORY_KINDS: { value: MemoryKind; label: string }[] = [
  { value: "tone", label: "Tone" },
  { value: "language", label: "Language" },
  { value: "length", label: "Length" },
  { value: "term", label: "Term" },
  { value: "instruction", label: "Instruction" },
];
const kindLabel = (k: MemoryKind) => MEMORY_KINDS.find((x) => x.value === k)?.label ?? k;
const PLACEHOLDER: Record<MemoryKind, string> = {
  tone: "Friendly and direct",
  language: "Use British spelling",
  length: "Keep answers short",
  term: "Atlas is our spring launch",
  instruction: "Use metric units",
};
const MAX_TEXT = 200;

function KindSelect({ value, onChange, label }: { value: MemoryKind; onChange: (k: MemoryKind) => void; label: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as MemoryKind)} aria-label={label} className="ui-input h-9 rounded-chip px-3 text-sm w-36 flex-none">
      {MEMORY_KINDS.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </Select>
  );
}

function Row({ item, onUpdate, onRemove }: { item: MemoryItem; onUpdate: (id: Id<"aiMemories">, kind: MemoryKind, text: string) => Promise<unknown>; onRemove: (id: Id<"aiMemories">) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<MemoryKind>(item.kind);
  const [text, setText] = useState(item.text);
  if (editing) {
    return (
      <li className="py-2">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void onUpdate(item.id, kind, text.trim()).then(() => setEditing(false), () => undefined);
          }}
        >
          <KindSelect value={kind} onChange={setKind} label="Kind" />
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_TEXT} aria-label="What to remember" autoFocus className="ui-input h-9 min-w-0 flex-1 rounded-chip px-3 text-sm" />
          <IconButton type="submit" label="Save" disabled={!text.trim()}>
            <Check size={15} aria-hidden />
          </IconButton>
          <IconButton
            label="Cancel"
            onClick={() => {
              setKind(item.kind);
              setText(item.text);
              setEditing(false);
            }}
          >
            <X size={15} aria-hidden />
          </IconButton>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="w-24 flex-none text-[12px] font-medium text-muted">{kindLabel(item.kind)}</span>
      <span className="min-w-0 flex-1 text-sm text-heading">
        {item.text}
        {item.workspace ? <span className="ml-2 text-[12px] text-faint">Only in {item.workspace.name}</span> : null}
      </span>
      <IconButton label={`Edit "${item.text}"`} onClick={() => setEditing(true)}>
        <Pencil size={14} aria-hidden />
      </IconButton>
      <IconButton label={`Delete "${item.text}"`} onClick={() => void onRemove(item.id)}>
        <Trash2 size={14} aria-hidden />
      </IconButton>
    </li>
  );
}

/**
 * The memory list itself (data in, changes out), so it can be shown and tested without a server: add with a
 * kind (and, with workspaces, where it applies), edit and delete each entry, and clear them all. While memory
 * is off it says so; what's there stays listed and can still be deleted.
 */
export function MemoryList({
  on,
  items,
  max,
  workspaces,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
}: {
  on: boolean;
  items: MemoryItem[];
  max: number;
  workspaces: { id: string; name: string }[];
  onAdd: (kind: MemoryKind, text: string, workspaceId: string | null) => Promise<unknown>;
  onUpdate: (id: Id<"aiMemories">, kind: MemoryKind, text: string) => Promise<unknown>;
  onRemove: (id: Id<"aiMemories">) => Promise<unknown>;
  onClear: () => Promise<unknown>;
}) {
  const [kind, setKind] = useState<MemoryKind>("instruction");
  const [text, setText] = useState("");
  const [where, setWhere] = useState("");
  const [confirming, setConfirming] = useState(false);
  const listId = useId();
  return (
    <div className="max-w-xl space-y-4">
      {on ? null : (
        <p role="status" className="rounded-control bg-sunken px-3 py-2 text-sm text-muted">
          Memory is off. Nothing here is used, and Foli AI won&apos;t offer to remember anything. What&apos;s saved stays until you delete it.
        </p>
      )}
      {on ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = text.trim();
            if (!value) return;
            void onAdd(kind, value, where || null).then(() => setText(""), () => undefined);
          }}
        >
          <KindSelect value={kind} onChange={setKind} label="Kind" />
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_TEXT} aria-label="What to remember" placeholder={PLACEHOLDER[kind]} className="ui-input h-9 min-w-0 flex-1 rounded-chip px-3 text-sm" />
          {workspaces.length ? (
            <Select value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Applies" className="ui-input h-9 rounded-chip px-3 text-sm w-44 flex-none">
              <option value="">Everywhere</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {`Only in ${w.name}`}
                </option>
              ))}
            </Select>
          ) : null}
          <Button type="submit" size="md" disabled={!text.trim() || items.length >= max}>
            Add
          </Button>
        </form>
      ) : null}
      {items.length ? (
        <ul id={listId} aria-label="What Foli AI remembers" className="divide-y divide-line/70">
          {items.map((item) => (
            <Row key={item.id} item={item} onUpdate={onUpdate} onRemove={onRemove} />
          ))}
        </ul>
      ) : (
        <EmptyState
          size="inline"
          title="Nothing yet"
          body={<>Add something here, like &ldquo;Use British spelling&rdquo; or &ldquo;Keep answers short&rdquo;, or save one when a chat or the agent offers it.</>}
        />
      )}
      {items.length ? (
        <Button variant="quiet" size="sm" onClick={() => setConfirming(true)}>
          Clear all
        </Button>
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear memory?"
        description="Everything Foli AI remembers about you is deleted, everywhere. This can't be undone."
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void onClear().then(() => setConfirming(false), () => undefined)}>
              Clear all
            </Button>
          </>
        }
      />
    </div>
  );
}

/** The same list as the iPhone app's rows: a Memory screen with Add, each memory its own screen. */
function IphoneMemoryList({ on, items, max, workspaces, onAdd, onUpdate, onRemove, onClear }: Parameters<typeof MemoryList>[0]) {
  const [kind, setKind] = useState<MemoryKind>("instruction");
  const [text, setText] = useState("");
  const [where, setWhere] = useState("");
  const screens = useSettingsScreens();
  const intro = "What Foli AI remembers about how you like it to write. It only keeps what you add here or save from a chat.";
  return (
    <>
      <IosSection footer={intro}>
        <IosRow icon={<RowIcon><Brain /></RowIcon>} label="Memories" value={items.length ? String(items.length) : on ? "Nothing yet" : "Off"} screen="memory" />
      </IosSection>
      <Subscreen id="memory" title="Memories">
        {on ? null : <IosSection><IosText muted>Memory is off. Nothing here is used, and Foli AI won&apos;t offer to remember anything. What&apos;s saved stays until you delete it.</IosText></IosSection>}
        {on ? (
          <IosSection header="Add" footer={items.length >= max ? `That's the most Foli AI keeps (${max}). Delete one to add another.` : undefined}>
            <ChoiceRow screen="memory.kind" label="Kind" value={kind} choices={MEMORY_KINDS} onChange={setKind} />
            <TextRow label="Remember" value={text} onChange={setText} placeholder={PLACEHOLDER[kind]} maxLength={MAX_TEXT} />
            {workspaces.length ? (
              <ChoiceRow screen="memory.where" label="Applies" value={where} choices={[{ value: "", label: "Everywhere" }, ...workspaces.map((w) => ({ value: w.id, label: `Only in ${w.name}` }))]} onChange={setWhere} />
            ) : null}
            <ActionRow label="Add" disabled={!text.trim() || items.length >= max} onClick={() => void onAdd(kind, text.trim(), where || null).then(() => setText(""), () => undefined)} />
          </IosSection>
        ) : null}
        <IosSection header={items.length ? "What Foli AI remembers" : undefined} label="What Foli AI remembers">
          {items.length ? (
            items.map((item) => <IosRow key={item.id} label={item.text} description={`${kindLabel(item.kind)}${item.workspace ? ` · Only in ${item.workspace.name}` : ""}`} screen={`memory.item-${item.id}`} />)
          ) : (
            <IosText muted>Nothing yet. Add something here, like &ldquo;Use British spelling&rdquo; or &ldquo;Keep answers short&rdquo;, or save one when a chat or the agent offers it.</IosText>
          )}
        </IosSection>
        {items.length ? (
          <IosSection footer="Everything Foli AI remembers about you is deleted, everywhere. This can't be undone.">
            <DestructiveRow label="Clear all" confirm="Clear memory" onConfirm={() => void onClear()} />
          </IosSection>
        ) : null}
        {items.map((item) => (
          <Subscreen key={item.id} id={`memory.item-${item.id}`} title={kindLabel(item.kind)}>
            <IosSection footer={item.workspace ? `Only in ${item.workspace.name}.` : undefined}>
              <ChoiceRow screen={`memory.item-${item.id}.kind`} label="Kind" value={item.kind} choices={MEMORY_KINDS} onChange={(k) => void onUpdate(item.id, k, item.text)} />
              <EditRow screen={`memory.item-${item.id}.text`} label="Remember" value={item.text} maxLength={MAX_TEXT} onSave={(t) => (t.trim() ? onUpdate(item.id, item.kind, t.trim()) : undefined)} />
            </IosSection>
            <IosSection>
              <DestructiveRow label="Delete" confirm="Delete memory" onConfirm={() => void onRemove(item.id).then(() => screens?.back())} />
            </IosSection>
          </Subscreen>
        ))}
      </Subscreen>
    </>
  );
}

/** Settings > AI: the Memory card, on the server's list. */
export function AiMemoryCard() {
  const { workspaces } = useAppState();
  const memory = useQuery(api.aiMemory.list, {});
  const add = useMutation(api.aiMemory.add);
  const update = useMutation(api.aiMemory.update);
  const remove = useMutation(api.aiMemory.remove);
  const clear = useMutation(api.aiMemory.clear);
  const toast = useToast();
  const report = <T,>(p: Promise<T>, done?: string) =>
    p.then(
      (r) => {
        if (done) toast.show(done);
        return r;
      },
      (e) => {
        toast.show(errorMessage(e), { tone: "error" });
        throw e;
      },
    );
  const iphone = useIphoneLook();
  if (iphone)
    return memory ? (
      <IphoneMemoryList
        on={memory.on}
        items={memory.items}
        max={memory.max}
        workspaces={workspaces.filter((w) => w.canEdit !== false).map((w) => ({ id: w.id, name: w.name }))}
        onAdd={(kind, text, workspaceId) => report(add({ kind, text, ...(workspaceId ? { workspaceId } : {}) }), "Remembered")}
        onUpdate={(id, kind, text) => report(update({ id, kind, text }), "Memory updated")}
        onRemove={(id) => report(remove({ id }), "Memory deleted")}
        onClear={() => report(clear({}), "Memory cleared")}
      />
    ) : null;
  return (
    <Card title="Memory" description="What Foli AI remembers about how you like it to write. It only keeps what you add here or save from a chat.">
      {memory ? (
        <MemoryList
          on={memory.on}
          items={memory.items}
          max={memory.max}
          workspaces={workspaces.filter((w) => w.canEdit !== false).map((w) => ({ id: w.id, name: w.name }))}
          onAdd={(kind, text, workspaceId) => report(add({ kind, text, ...(workspaceId ? { workspaceId } : {}) }), "Remembered")}
          onUpdate={(id, kind, text) => report(update({ id, kind, text }), "Memory updated")}
          onRemove={(id) => report(remove({ id }), "Memory deleted")}
          onClear={() => report(clear({}), "Memory cleared")}
        />
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </Card>
  );
}
