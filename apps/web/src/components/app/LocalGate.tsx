"use client";

import { useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { localDate } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useLocalClient } from "@/lib/convex/provider";
import { AppStateProvider, FullPageMessage } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { shell } from "@/lib/shell";
import { clearSetupIntent, setupIntent } from "@/lib/local/libraryPlace";
import { useLibraryControl, useLibraryStatusPick } from "@/lib/local/useLibrary";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { Shell } from "./Shell";
import { LibraryPlaceSync } from "@/components/places/LibraryPlaceSync";
import { LockedLibrary } from "./LockedLibrary";

// The Mac app's Quick Add window (its own page): loaded only there.
const DesktopQuickAdd = lazy(() => import("./DesktopQuickAdd").then((m) => ({ default: m.DesktopQuickAdd })));

/**
 * True when this device is joining a library other devices made: LibrarySetup said so, or (without its
 * word, say the origin's storage was cleared) the library already holds notes.
 */
async function joiningExisting(): Promise<boolean> {
  const intent = setupIntent();
  if (intent) return intent === "join";
  const library = shell()?.library;
  if (!library) return false;
  try {
    return (await library.list("notes")).some((e) => e.path.endsWith(".fnote"));
  } catch {
    return false;
  }
}

/**
 * Local mode's AccountGate (docs/LOCAL_MODE_PLAN.md §2.3): the library's own profile, no sign-in, session,
 * bootstrap or device limit. Where the library lives is chosen before this (ShellRoot, LibrarySetup).
 *
 * - An encrypted library this device can't read yet asks for its passphrase first (LockedLibrary).
 * - A brand-new library is set up here with the welcome notes every account starts with (lib/local/setup.ts).
 * - A library made on another device is joined: its profile comes with its index, and the notes list fills
 *   from the other devices' catalogs while the notes download. No welcome notes are added to it. If a whole
 *   sync has finished and no profile came (an index that never made it), it's set up without them.
 */
export function LocalGate() {
  const me = useQuery(api.users.me, {});
  const local = useLocalClient();
  const control = useLibraryControl();
  const needsSetup = me?.state === "needs_bootstrap";
  // Only the facts this gate decides on, and only while it needs them: it draws the whole app, so not again on
  // every sync step and save (a sync turning `settled` over and back, the note count growing).
  const locked = useLibraryStatusPick(control, (s) => s?.state === "locked");
  const settled = useLibraryStatusPick(control, (s) => needsSetup && !!s && s.lastSyncAt !== null && !s.syncing && !s.health.downloading.some((h) => h.path.startsWith("index/")));
  const found = useLibraryStatusPick(control, (s) => (needsSetup ? (s?.notes.total ?? 0) : 0));
  const where = useLibraryStatusPick(control, (s) => (s?.state === "locked" ? (s.info?.displayPath ?? null) : null));
  const { route } = useAppRouter();
  const started = useRef(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [joining, setJoining] = useState<boolean | null>(null);

  // The product uses neutral chrome so the notes carry the colour (globals.css, data-chrome).
  useEffect(() => {
    document.documentElement.dataset.chrome = "neutral";
    return () => {
      delete document.documentElement.dataset.chrome;
    };
  }, []);

  useEffect(() => {
    if (!needsSetup || joining !== null || locked) return;
    let live = true;
    void joiningExisting().then((j) => live && setJoining(j));
    return () => {
      live = false;
    };
  }, [needsSetup, joining, locked]);

  const runSetup = (seed: boolean) => {
    if (started.current || !local) return;
    started.current = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    local.local
      .setup({ timeZone, locale: (navigator.language || "en").slice(0, 5), today: localDate(Date.now(), timeZone), seed })
      .then(() => clearSetupIntent())
      .catch((e) => setSetupError(errorMessage(e)));
  };

  // A new library.
  useEffect(() => {
    if (needsSetup && joining === false && !locked) runSetup(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runSetup runs once (started)
  }, [needsSetup, joining, locked, local]);

  // Joining: wait for the profile to arrive with the library's index.
  useEffect(() => {
    if (!needsSetup || joining !== true || locked || !settled) return;
    const timer = setTimeout(() => runSetup(false), 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runSetup runs once (started)
  }, [needsSetup, joining, locked, settled, local]);

  useEffect(() => {
    if (me?.state === "ready") clearSetupIntent();
  }, [me?.state]);

  if (setupError) {
    return (
      <FullPageMessage title="We couldn't set up your notes" body={setupError}>
        <Button variant="primary" onClick={() => location.reload()}>
          Try again
        </Button>
      </FullPageMessage>
    );
  }
  if (locked && control) return <LockedLibrary control={control} where={where} />;
  if (me?.state !== "ready") {
    if (needsSetup && joining) {
      const count = found;
      return (
        <FullPageMessage
          title="Joining your library…"
          busy
          body={count > 0 ? `${count} ${count === 1 ? "note" : "notes"} found so far. Folevi lists them while they download.` : "Folevi is reading what your other devices saved. A large library takes a little while the first time."}
        />
      );
    }
    return <FullPageMessage title="Opening your folio…" busy />;
  }
  return <AppStateProvider profile={me.profile}>{route.name === "place-sync" ? <LibraryPlaceSync /> : route.name === "quick-add" ? <Suspense fallback={null}><DesktopQuickAdd /></Suspense> : <Shell />}</AppStateProvider>;
}
