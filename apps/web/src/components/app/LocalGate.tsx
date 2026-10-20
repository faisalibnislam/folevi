"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { localDate } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useLocalClient } from "@/lib/convex/provider";
import { AppStateProvider, FullPageMessage } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { Shell } from "./Shell";
import { DesktopQuickAdd } from "./DesktopQuickAdd";

/**
 * Local mode's AccountGate (docs/LOCAL_MODE_PLAN.md §2.3): the library's own profile, no sign-in, session,
 * bootstrap or device limit. The first time a library opens it's set up here, with the welcome notes every
 * account starts with (lib/local/setup.ts). Choosing where the library lives comes before this (WP10).
 */
export function LocalGate() {
  const me = useQuery(api.users.me, {});
  const local = useLocalClient();
  const { route } = useAppRouter();
  const started = useRef(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // The product uses neutral chrome so the notes carry the colour (globals.css, data-chrome).
  useEffect(() => {
    document.documentElement.dataset.chrome = "neutral";
    return () => {
      delete document.documentElement.dataset.chrome;
    };
  }, []);

  useEffect(() => {
    if (me?.state !== "needs_bootstrap" || started.current || !local) return;
    started.current = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    local.local
      .setup({ timeZone, locale: (navigator.language || "en").slice(0, 5), today: localDate(Date.now(), timeZone) })
      .catch((e) => setSetupError(errorMessage(e)));
  }, [me?.state, local]);

  if (setupError) {
    return (
      <FullPageMessage title="We couldn't set up your notes" body={setupError}>
        <Button variant="primary" onClick={() => location.reload()}>
          Try again
        </Button>
      </FullPageMessage>
    );
  }
  if (me?.state !== "ready") return <FullPageMessage title="Opening your folio…" busy />;
  return <AppStateProvider profile={me.profile}>{route.name === "quick-add" ? <DesktopQuickAdd /> : <Shell />}</AppStateProvider>;
}
