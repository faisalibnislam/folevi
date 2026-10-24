"use client";
// Settings > Import & export > Takeout (docs/MULTI_ACCOUNT_PLAN.md §8): an account downloads one file with
// everything it has (notes, files, history, folders, tags, and the workspaces the person manages as folders), and
// any place (an account, or the library in the apps) imports one, into a folder of its own. The file is a library
// folder in a zip, so it also opens as a library as it is.
import { useConvex } from "convex/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { useAppState } from "@/lib/app/state";
import { useLocalClient } from "@/lib/convex/provider";
import { useBackendMode } from "@/lib/mode";
import { shell } from "@/lib/shell";
import { errorText } from "@/lib/migrate/copy";
import { manageableWorkspaces } from "@/lib/migrate/exportToLocal";
import { importTakeout, makeTakeout } from "@/lib/migrate/takeout";
import { accountUpload, clientTarget, libraryPutFile } from "@/lib/migrate/target";
import type { MigrationClient, MigrationProgress } from "@/lib/migrate/types";
import { Card } from "@/components/views/settings/Card";

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

function progressWords(p: MigrationProgress | null, verb: string): string {
  if (!p || p.phase === "organizing") return `${verb}: folders and tags…`;
  if (p.phase === "trash") return `${verb}: Trash…`;
  return `${verb}: ${p.notesDone.toLocaleString()} of ${plural(p.notesTotal, "note")}`;
}

async function saveFile(name: string, bytes: Uint8Array): Promise<boolean> {
  const host = shell();
  if (host) return await host.files.save(name, bytes);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export function TakeoutCard() {
  const client = useConvex() as unknown as MigrationClient;
  const local = useLocalClient();
  const mode = useBackendMode();
  const { profile, deviceId } = useAppState();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const workspaces = await manageableWorkspaces(client).catch(() => []);
      const { bytes, manifest } = await makeTakeout({ account: client, who: { name: profile.displayName, email: profile.email ?? "" }, workspaces, onProgress: (p) => setStatus(progressWords(p, p.place === "Personal" ? "Personal" : p.place)) });
      const day = new Date().toISOString().slice(0, 10);
      const saved = await saveFile(`Folevi takeout ${profile.email || profile.displayName} ${day}.zip`, bytes);
      setStatus(saved ? `The file holds ${plural(manifest.notes, "note")}. It isn't encrypted: keep it somewhere safe.` : null);
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const zip = new Uint8Array(await file.arrayBuffer());
      const target = clientTarget(client, { deviceId: deviceId ?? "takeout-import", putFile: local ? libraryPutFile(local.local) : accountUpload(client) });
      const { state, folder } = await importTakeout({ zip, target, onProgress: (p) => setStatus(progressWords(p, "Importing")) });
      const missing = state.problems.filter((p) => p.kind === "file").length;
      setStatus(`${plural(Object.keys(state.notes).length, "note")} came in, in the folder “${folder.name}”.${missing ? ` ${plural(missing, "file")} didn't come along.` : ""}`);
      toast.show("Takeout imported");
    } catch (e) {
      setStatus(null);
      toast.show(e instanceof Error && e.name === "TakeoutError" ? e.message : errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card
      title="Takeout"
      description={
        mode === "local"
          ? "Import a takeout file from a Folevi account: everything in it comes into this library, in a folder of its own."
          : "One file with everything in your account: notes, files, history, folders and tags, and the workspaces you manage. Another account or a library on your Mac, iPhone, iPad or phone can import it."
      }
    >
      <div className="flex flex-wrap gap-2">
        {mode === "account" ? (
          <Button variant="primary" disabled={busy} onClick={() => void download()}>
            Download a takeout file
          </Button>
        ) : null}
        <Button disabled={busy} onClick={() => input.current?.click()}>
          Import a takeout file…
        </Button>
        <input ref={input} type="file" accept=".zip,application/zip" hidden aria-hidden tabIndex={-1} onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
      </div>
      {status ? (
        <p className="mt-2 text-footnote text-muted" role="status">
          {status}
        </p>
      ) : null}
    </Card>
  );
}
