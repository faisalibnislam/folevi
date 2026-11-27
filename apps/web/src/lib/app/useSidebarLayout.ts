"use client";

import { useMutation } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/convex/api";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { resolveSidebarLayout, saveSidebarLayout, type SidebarSlot } from "./sidebarLayout";

/**
 * This person's sidebar layout (lib/app/sidebarLayout.ts), as last seen on this device until the live one comes,
 * and a way to change it: the change shows at once and is saved with their account.
 */
export function useSidebarLayout(): { slots: SidebarSlot[]; save: (next: readonly SidebarSlot[] | null) => void } {
  const saved = useOfflineQuery(api.sidebarLayout.get, {});
  const set = useMutation(api.sidebarLayout.set);
  const toast = useToast();
  // The change in front of the saved layout until the server has it.
  const [pending, setPending] = useState<{ slots: SidebarSlot[] } | null>(null);
  const slots = useMemo(() => pending?.slots ?? resolveSidebarLayout(saved), [pending, saved]);
  const save = useCallback(
    (next: readonly SidebarSlot[] | null) => {
      const mine = { slots: next ? [...next] : resolveSidebarLayout(null) };
      setPending(mine);
      const wire = next ? saveSidebarLayout(next) : null;
      set({ layout: wire ? { order: [...wire.order], more: [...wire.more] } : null })
        .catch((e) => toast.show(errorMessage(e), { tone: "error" }))
        .finally(() => setPending((p) => (p === mine ? null : p)));
    },
    [set, toast],
  );
  return { slots, save };
}
