"use client";
// Moving between "Keep notes on my devices" and a Folevi account (docs/LOCAL_MODE_PLAN.md §6), from Settings >
// Import & export in the signed-in Mac app: "Keep my notes on this Mac" (the account comes down into a library,
// then this Mac signs out) and, once a library has gone up, "Remove the local copy…". Going up starts from
// Settings > Library in local mode ("Sign in to Folevi", lib/local/signIn.ts).
import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/views/settings/Card";
import { useAppState } from "@/lib/app/state";
import { useBackendMode } from "@/lib/mode";
import { shell } from "@/lib/shell";
import type { LibraryKind } from "@/lib/shell/types";
import { errorText } from "@/lib/migrate/copy";
import { manageableWorkspaces, type ExportableWorkspace } from "@/lib/migrate/exportToLocal";
import { removeLocalCopy, setPendingMove } from "@/lib/migrate/session";
import { migratedTo } from "@/lib/migrate/uploadLibrary";

/**
 * The cards for a signed-in Mac (Personal's Import & export); nothing in local mode, where Settings > Library
 * has "Sign in to Folevi" (lib/local/signIn.ts), or outside the app shell.
 */
export function MoveBetweenModes() {
  const mode = useBackendMode();
  if (!shell()?.library || mode === "local") return null;
  return <AccountCards />;
}

function AccountCards() {
  return (
    <>
      <MoveToThisMacCard />
      <LocalCopyCard />
    </>
  );
}

const PLACES: { kind: LibraryKind; label: string }[] = [
  { kind: "device", label: "This Mac only" },
  { kind: "icloud", label: "iCloud Drive" },
  { kind: "folder", label: "A folder you choose" },
];

/** Signed in: the account comes down into a library on this Mac, and this Mac signs out. */
function MoveToThisMacCard() {
  const client = useConvex();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LibraryKind>("device");
  const [versions, setVersions] = useState(true);
  const [workspaces, setWorkspaces] = useState<ExportableWorkspace[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void manageableWorkspaces(client).then((w) => live && setWorkspaces(w), () => undefined);
    return () => {
      live = false;
    };
  }, [open, client]);
  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { setupLibraryLocation } = await import("@/lib/local/store/index");
      const info = await setupLibraryLocation(kind);
      // The folder picker was closed: nothing starts.
      if (!info) return;
      setPendingMove({ direction: "export", startedAt: Date.now(), versions, kind, workspaces: workspaces.filter((w) => chosen.has(w.id)) });
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Keep my notes on this Mac"
      description="Folevi copies everything in your Personal, Archive and Trash too, into a library on this Mac, then signs out here. Your account isn’t deleted."
    >
      <Button onClick={() => setOpen(true)} data-testid="move-to-this-mac">
        Keep my notes on this Mac…
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Keep your notes on this Mac"
        description="Every note, folder, tag and file comes along, with the same links between them. Comments, sharing and workspace members need an account; a record of them goes in the library."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void start()}>
              {busy ? "Starting…" : "Bring my notes here"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <label className="grid gap-1.5">
            <span className="font-medium">Where the library goes</span>
            <Select value={kind} onChange={(e) => setKind(e.target.value as LibraryKind)} aria-label="Where the library goes" className="ui-input h-9 w-full rounded-chip px-3 text-sm">
              {PLACES.map((p) => (
                <option key={p.kind} value={p.kind}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>Bring version history</span>
            <Switch checked={versions} onChange={setVersions} label="Bring version history" />
          </label>
          {workspaces.length ? (
            <div className="grid gap-2">
              <span className="font-medium">Workspaces you manage</span>
              {workspaces.map((w) => (
                <Checkbox
                  key={w.id}
                  checked={chosen.has(w.id)}
                  onChange={(next) =>
                    setChosen((s) => {
                      const out = new Set(s);
                      if (next) out.add(w.id);
                      else out.delete(w.id);
                      return out;
                    })
                  }
                >
                  Bring “{w.name}” as a folder
                </Checkbox>
              ))}
              <p className="text-muted">The workspace stays as it is for everyone in it.</p>
            </div>
          ) : null}
          <p className="text-muted">Afterwards Folevi signs out on this Mac. Your account is still there, and you can sign in again any time.</p>
          {problem ? (
            <p role="alert" className="text-danger">
              {problem}
            </p>
          ) : null}
        </div>
      </Dialog>
    </Card>
  );
}

/** After a library went up: its folder is still on this Mac, and can go. */
function LocalCopyCard() {
  const { profile } = useAppState();
  const toast = useToast();
  const [where, setWhere] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const library = shell()?.library;
      if (!library) return;
      const to = await migratedTo(library as never).catch(() => null);
      if (to !== profile.id) return;
      const info = await library.info().catch(() => null);
      if (live) setWhere(info?.displayPath ?? "this Mac");
    })();
    return () => {
      live = false;
    };
  }, [profile.id]);
  if (!where) return null;
  const remove = async () => {
    setBusy(true);
    try {
      await removeLocalCopy();
      setWhere(null);
      toast.show("The local copy is removed. Your notes are in your account.");
    } catch (e) {
      toast.show(errorText(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <Card title="Your library from before" description={`The library you moved into this account is still in ${where}, as it was before the move.`}>
      <Button onClick={() => setConfirm(true)} data-testid="remove-local-copy">
        Remove the local copy…
      </Button>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title="Remove the local copy?"
        description={`Folevi removes the library’s notes, files and history from ${where}. Everything is in your account; this can’t be undone. Other files in that folder stay.`}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Keep it</Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy ? "Removing…" : "Remove"}
            </Button>
          </>
        }
      />
    </Card>
  );
}
