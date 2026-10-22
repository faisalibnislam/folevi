"use client";
// The library's runner in the apps (docs/MULTI_ACCOUNT_PLAN.md §5.2): a hidden window on /place-sync while an
// account is open. Being the library's page is the work: it hosts the library (lib/local/host.ts), so what was
// written here goes out to the folder, what other devices wrote comes in, and their reminders get scheduled. It
// tells the app what's waiting, for the switcher's dot.
import { useEffect, useState } from "react";
import { useAppState } from "@/lib/app/state";
import { shell } from "@/lib/shell";

export function LibraryPlaceSync() {
  const { engine } = useAppState();
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!engine) return;
    const read = () => setWaiting(engine.pendingCount());
    read();
    return engine.subscribe(read);
  }, [engine]);
  useEffect(() => {
    void shell()
      ?.places?.describe({ profileId: "", name: "", email: "", avatarUrl: null, workspaces: [], waiting })
      .catch(() => undefined);
  }, [waiting]);
  return (
    <main aria-hidden className="sr-only">
      Keeping the library in sync
    </main>
  );
}
