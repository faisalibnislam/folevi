"use client";
// Save to Folevi: what another app shared (the system share sheet, through the PWA's share target and the
// service worker) or what the bookmarklet sent (/share?title=…&url=…&text=…), saved as a note under the
// Inbox page of the place chosen (lib/share/save.ts): made through the sync engine like any other page, so
// it is kept on this device first and works offline; shared images and PDFs go through the usual upload queue.
import { useMutation } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { FileText, ImageIcon, Link2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { normaliseShare, shareFileKind, type SharePayload } from "@/lib/share/payload";
import { saveShare } from "@/lib/share/save";
import { forgetReceivedShare, readReceivedShare } from "@/lib/share/received";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { errorMessage } from "@/components/ui/Toast";

type Loaded = { payload: SharePayload; files: File[]; skipped: string[]; receivedId: string | null };
type Saved = { noteId: string; place: string; synced: boolean };

/** Files of a note still waiting to upload (they upload while Folevi is open on this device). */
function useUploadsLeft(noteId: string | null): number {
  const { engine } = useAppState();
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!engine || !noteId) return;
    const count = () => setLeft(engine.state.uploads.filter((u) => u.documentId === noteId).length);
    count();
    return engine.subscribe(count);
  }, [engine, noteId]);
  return left;
}

export function ShareSheet() {
  const { engine, profile, workspaces, scope: current, online, deviceId } = useAppState();
  const { search, navigate } = useAppRouter();
  const prepareInbox = useMutation(api.tasks.inbox);
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const places = useMemo(() => [{ id: "personal", name: "Personal" }, ...workspaces.filter((w) => w.canEdit !== false).map((w) => ({ id: w.id, name: w.name }))], [workspaces]);
  const [place, setPlace] = useState(() => (current.kind === "workspace" && places.some((p) => p.id === current.workspaceId) ? current.workspaceId : "personal"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const uploadsLeft = useUploadsLeft(saved?.noteId ?? null);

  const receivedId = search.get("received");
  useEffect(() => {
    let live = true;
    void (async () => {
      if (receivedId) {
        const got = await readReceivedShare(receivedId);
        if (!live) return;
        if (!got) return setLoaded(null);
        const files = got.files.filter((f) => shareFileKind(f));
        const skipped = [...got.skipped, ...got.files.filter((f) => !shareFileKind(f)).map((f) => f.name)];
        setLoaded({ payload: normaliseShare(got), files, skipped, receivedId });
      } else {
        const payload = normaliseShare({ title: search.get("title"), text: search.get("text"), url: search.get("url") });
        const skippedCount = Math.min(Number(search.get("skipped") ?? "0") || 0, 99);
        setLoaded(payload.title || payload.text || payload.url ? { payload, files: [], skipped: Array.from({ length: skippedCount }, () => "file"), receivedId: null } : null);
      }
    })();
    return () => {
      live = false;
    };
    // Read once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (loaded) setTitle(loaded.payload.title);
  }, [loaded]);

  const close = () => {
    // A window the bookmarklet opened closes; anywhere else (the installed app) Folevi opens.
    window.close();
    setTimeout(() => navigate("/documents", { replace: true }), 150);
  };
  const discard = async () => {
    if (loaded?.receivedId) await forgetReceivedShare(loaded.receivedId);
    close();
  };

  const save = async () => {
    if (!engine || !loaded || busy) return;
    setBusy(true);
    setError(null);
    const placeName = places.find((p) => p.id === place)?.name ?? "Personal";
    try {
      const { noteId, synced } = await saveShare({ engine, profileId: profile.id, deviceId, online, prepareInbox }, { payload: loaded.payload, files: loaded.files, title, place });
      if (loaded.receivedId) await forgetReceivedShare(loaded.receivedId);
      setSaved({ noteId, place: placeName, synced });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const frame = (children: React.ReactNode) => (
    <div className="ui-canvas ui-neutral-chrome grid min-h-dvh place-items-center px-4 py-8">
      <div className="w-full max-w-md">
        <span className="mb-5 inline-flex items-center gap-2 text-ink">
          <FoleviLogo height={24} title="Folevi" />
        </span>
        <main id="main" aria-labelledby="share-heading" className="ui-card rounded-control p-6">
          {children}
        </main>
      </div>
    </div>
  );

  if (loaded === undefined) return frame(<p className="text-muted">Opening what you shared…</p>);
  if (loaded === null) {
    return frame(
      <>
        <h1 id="share-heading" className="ui-display text-[24px] leading-tight">
          Nothing to save
        </h1>
        <p className="mt-2 text-[14px] text-muted">Share a page, a link or some text to Folevi, or use the Save to Folevi bookmarklet from Settings.</p>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => navigate("/documents", { replace: true })}>
            Open Folevi
          </Button>
        </div>
      </>,
    );
  }
  if (saved) {
    return frame(
      <>
        <h1 id="share-heading" className="ui-display text-[24px] leading-tight">
          Saved to your Inbox
        </h1>
        <p className="mt-2 text-[14px] text-muted" role="status">
          {saved.synced ? `It’s in the Inbox in ${saved.place}.` : `It’s saved on this device and goes to the Inbox in ${saved.place} as soon as Folevi is back online.`}
          {uploadsLeft ? ` Uploading ${uploadsLeft === 1 ? "1 file" : `${uploadsLeft} files`}: keep Folevi open until it’s done.` : ""}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={close}>Done</Button>
          <Button variant="primary" onClick={() => navigate(`/d/${saved.noteId}`)}>
            Open note
          </Button>
        </div>
      </>,
    );
  }

  const { payload, files, skipped } = loaded;
  return frame(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h1 id="share-heading" className="ui-display text-[24px] leading-tight">
        Save to Folevi
      </h1>
      <label htmlFor="share-title" className="ui-caps mt-5 mb-1.5 block">
        Title
      </label>
      <input id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Untitled" className="h-10 w-full ui-input rounded-chip px-3 text-[15px] outline-none" />
      {payload.url || payload.text || files.length ? (
        <div className="mt-4 space-y-2 ui-well rounded-chip p-3 text-[13px]" aria-label="What will be saved">
          {payload.url ? (
            <p className="flex min-w-0 items-center gap-2 text-ink">
              <Link2 size={14} aria-hidden className="flex-none text-muted" />
              <span className="truncate" title={payload.url}>
                {payload.url}
              </span>
            </p>
          ) : null}
          {payload.text ? <p className="line-clamp-6 whitespace-pre-wrap break-words text-muted">{payload.text}</p> : null}
          {files.map((f, i) => (
            <p key={i} className="flex min-w-0 items-center gap-2 text-ink">
              {shareFileKind(f) === "image" ? <ImageIcon size={14} aria-hidden className="flex-none text-muted" /> : <FileText size={14} aria-hidden className="flex-none text-muted" />}
              <span className="truncate">{f.name}</span>
            </p>
          ))}
        </div>
      ) : null}
      {skipped.length ? (
        <p className="mt-2 text-[12.5px] text-muted">
          {skipped.every((n) => n === "file")
            ? `${skipped.length === 1 ? "A file" : `${skipped.length} files`} couldn’t be received. Open Folevi once on this device, then share again to include files.`
            : `Left out: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ` and ${skipped.length - 5} more` : ""}. Folevi takes images and PDFs up to 20 MB.`}
        </p>
      ) : null}
      <label id="share-place-label" className="ui-caps mt-5 mb-1.5 block">
        Save to
      </label>
      <Select value={place} onChange={(e) => setPlace(e.target.value)} aria-labelledby="share-place-label" className="h-10 w-full ui-input rounded-chip px-3 text-sm">
        {places.map((p) => (
          <option key={p.id} value={p.id}>
            {`Inbox in ${p.name}`}
          </option>
        ))}
      </Select>
      {!online ? <p className="mt-3 text-[12.5px] text-muted">You’re offline. The note is kept on this device and reaches your Inbox when you’re back online.</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="quiet" onClick={() => void discard()} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !engine}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>,
  );
}
