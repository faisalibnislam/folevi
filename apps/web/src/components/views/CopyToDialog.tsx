"use client";

import { useMutation } from "convex/react";
import { useCapabilities } from "@/lib/mode";
import { useEffect, useId, useState } from "react";
import { flattenFolders, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useFolderTree } from "@/lib/app/folders";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";

const PERSONAL = "personal";

/** Whether there's another place to copy notes to (Personal, or a workspace where you can add pages). */
export function useCanCopyElsewhere(): boolean {
  const { scope, workspaces } = useAppState();
  // A local library is the only place there is (docs/LOCAL_MODE_PLAN.md §2.4).
  if (!useCapabilities().copyTo) return false;
  return scope.kind === "workspace" || workspaces.some((w) => w.canEdit !== false);
}

/**
 * Copy notes to another place: your Personal or a workspace where you can add pages, into Drafts or a
 * folder there. Each note becomes a new note in that place (with its sub-pages unless that's turned off);
 * the original stays where it is. convex/copies.ts does the copying.
 */
export function CopyToDialog({
  open,
  onClose,
  documentIds,
  noteTitle,
  from,
}: {
  open: boolean;
  onClose: () => void;
  documentIds: string[];
  noteTitle?: string;
  /** Where the notes are now (default: the place you're in; null: none of yours, a page shared with you). */
  from?: WireScope | null;
}) {
  const { scope: here, workspaces, setContext } = useAppState();
  const { navigate } = useAppRouter();
  const copyTo = useMutation(api.copies.copyTo);
  const toast = useToast();
  const ids = useId();
  // Places you can add pages to; the place you're in comes first after Personal, as in the switcher.
  const places = [{ key: PERSONAL, name: "Personal" }, ...workspaces.filter((w) => w.canEdit !== false).map((w) => ({ key: w.id, name: w.name }))];
  const source = from === undefined ? here : from;
  const hereKey = source === null ? null : source.kind === "personal" ? PERSONAL : source.workspaceId;
  const currentKey = here.kind === "personal" ? PERSONAL : here.workspaceId;
  // Somewhere other than here by default: copying is mostly for taking a note across.
  const defaultPlace = places.find((p) => p.key !== hereKey)?.key ?? PERSONAL;
  const [place, setPlace] = useState(defaultPlace);
  const [folderId, setFolderId] = useState("");
  const [withSubpages, setWithSubpages] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPlace(defaultPlace);
    setFolderId("");
    setWithSubpages(true);
    setBusy(false);
    // Only when the dialog opens: the place list doesn't reset a choice being made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const destination: WireScope = place === PERSONAL ? { kind: "personal" } : { kind: "workspace", workspaceId: place };
  const org = useFolderTree(open ? destination : "skip");
  const placeName = places.find((p) => p.key === place)?.name ?? "Personal";
  const count = documentIds.length;
  const what = count === 1 ? `“${noteTitle?.trim() || "Untitled"}”` : `${count.toLocaleString()} notes`;

  const run = async () => {
    setBusy(true);
    const made: string[] = [];
    try {
      for (const documentId of documentIds) {
        const r = await copyTo({ documentId, destination, folderId: folderId || null, includeSubpages: withSubpages });
        made.push(r.id);
      }
    } catch (e) {
      setBusy(false);
      toast.show(made.length ? `Copied ${made.length} of ${count} notes. ${errorMessage(e)}` : errorMessage(e), { tone: "error" });
      if (!made.length) return;
      onClose();
      return;
    }
    onClose();
    const first = made[0]!;
    toast.show(count === 1 ? `Copied to ${placeName}` : `Copied ${count.toLocaleString()} notes to ${placeName}`, {
      action: {
        label: "Open",
        onClick: () => {
          // A note opens in its own place: switch there first when it's somewhere else.
          if (place !== currentKey) setContext(destination);
          navigate(`/d/${first}`);
        },
      },
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Copy ${what}`}
      description="The copy is a new note in the place you pick. Comments and version history stay with the original."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void run()}>
            {busy ? "Copying…" : "Copy"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={`${ids}-place`} className="block text-subheadline font-medium">
            Copy to
          </label>
          <Select
            id={`${ids}-place`}
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setFolderId("");
            }}
            className="ui-input mt-1.5 h-10 w-full rounded-chip px-3 text-callout"
          >
            {places.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key === hereKey ? `${p.name} (here)` : p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={`${ids}-folder`} className="block text-subheadline font-medium">
            Folder
          </label>
          <Select id={`${ids}-folder`} value={folderId} onChange={(e) => setFolderId(e.target.value)} className="ui-input mt-1.5 h-10 w-full rounded-chip px-3 text-callout" disabled={org === undefined}>
            <option value="">No folder (Drafts)</option>
            {flattenFolders(org?.folders ?? []).map(({ folder: f, depth }) => (
              <option key={f.id} value={f.id}>
                {"   ".repeat(depth)}
                {f.name}
              </option>
            ))}
          </Select>
        </div>
        <Checkbox checked={withSubpages} onChange={setWithSubpages} describedBy={`${ids}-sub`}>
          <span className="text-subheadline">Include sub-pages</span>
        </Checkbox>
        <p id={`${ids}-sub`} className="text-subheadline text-muted">
          Links between the copied pages lead to the copies. Images and files are copied too and count toward the storage there. A collection is copied as a table of what it shows.
        </p>
      </div>
    </Dialog>
  );
}
