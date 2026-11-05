// Revision 10's view (R13.3, plan 11.8): Settings > This device, the copy of this place's notes kept on this
// device (lib/sync/deviceCopy.ts, run by components/app/DeviceCopyRunner.tsx): whether all notes are kept, each
// space's progress, what it takes, and what's free.
import { measureDeviceUsage, type DeviceUsage } from "@/lib/sync/deviceUsage";
import { deviceCopyOf, keepAllNotes, onDeviceCopies, onKeepAllNotes } from "@/lib/sync/deviceCopyHost";
import { scopeIdKey } from "@folevi/editor-schema";
import type { EngineDeps, ViewContext } from "./context";
import { Emitter, type Signal } from "./live";
import { engineSignal, outboxSignal, type ValueViewDef } from "./views";
import { only } from "./validate";
import type { DeviceStorageValue, SpaceCopyInfo, ViewName } from "./protocol";

/** Changes waiting on this device: page edits and other changes together. */
export function waitingCount(deps: EngineDeps): number {
  const s = deps.app.engine?.state;
  return (s ? s.pending.length + s.inflight.length : 0) + (deps.app.outbox?.entries.length ?? 0);
}

/**
 * Measures with every reading on its own and time-limited (lib/sync/deviceUsage.ts, QA F19): before, one storage
 * estimate that never answered in the apps' WebKit held back Notes kept and Space used, which stayed "…" for
 * good. Now the view is never stale for more than a few seconds; a reading it couldn't get is null, which the
 * apps show as "Unavailable" with Retry (watching the view again measures again).
 */
const measure = (accountKey: string): Promise<DeviceUsage> => measureDeviceUsage(accountKey);

/** The copy's handle for this account and its changes, as a signal (the copy starts and stops with the app). */
function copySignal(accountKey: string): Signal {
  return new Emitter((emit) => {
    let off: (() => void) | null = null;
    const bind = () => {
      off?.();
      const h = deviceCopyOf(accountKey);
      off = h ? h.copy.subscribe(emit) : null;
    };
    bind();
    const offHandles = onDeviceCopies(() => {
      bind();
      emit();
    });
    const offSetting = onKeepAllNotes(emit);
    return () => {
      off?.();
      offHandles();
      offSetting();
    };
  });
}

const deviceStorage: ValueViewDef = {
  kind: "value",
  parse: (args) => (only(args, []), {}),
  create: (ctx: ViewContext) => {
    const accountKey = ctx.deps().app.accountKey;
    const copy = copySignal(accountKey);
    let usage: DeviceUsage | null = null;
    // Measured at least once (a failed measure leaves the numbers unknown, not loading forever).
    let measuredOnce = false;
    const measured = new Emitter();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Measured at first and again a moment after the copy moves (counting takes a read of the database).
    const remeasure = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void measure(accountKey).then((u) => {
          usage = u;
          measuredOnce = true;
          measured.emit();
        });
      }, measuredOnce ? 1500 : 0);
    };
    const live = new Emitter((emit) => {
      remeasure();
      const off = copy.subscribe(() => {
        remeasure();
        emit();
      });
      return () => {
        off();
        if (timer) clearTimeout(timer);
        timer = null;
      };
    });
    return {
      signals: [live, measured, ctx.appSignal, engineSignal(ctx), outboxSignal(ctx)],
      compute: () => {
        const d = ctx.deps();
        const handle = deviceCopyOf(accountKey);
        const status = handle?.copy.status() ?? [];
        const spaces: SpaceCopyInfo[] = d.app.spaces.map((sp) => {
          const st = status.find((x) => x.scopeKey === scopeIdKey(sp.scope));
          if (d.spaceStatus(sp.scope).encrypted) return { space: sp.id, name: sp.name, phase: "encrypted", have: 0, total: null };
          return { space: sp.id, name: sp.name, phase: st?.phase ?? "listing", have: st?.have ?? 0, total: st?.total ?? null };
        });
        const value: DeviceStorageValue = {
          place: d.app.place,
          keepAll: keepAllNotes(accountKey),
          available: Boolean(handle),
          spaces,
          notesKept: usage?.notes ?? null,
          attachmentsKept: usage?.files?.count ?? null,
          attachmentsBytes: usage?.files?.bytes ?? null,
          usedBytes: usage?.used ?? null,
          freeBytes: usage?.free ?? null,
          attachmentLimitBytes: usage?.budget ?? null,
          waiting: waitingCount(d),
        };
        return { value, stale: !measuredOnce, error: null };
      },
    };
  },
};

export const DEVICE_VALUE_VIEWS = {
  "device.storage": deviceStorage,
} satisfies Partial<Record<ViewName, ValueViewDef>>;
