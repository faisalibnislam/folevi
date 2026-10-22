// The feature workers (docs/E2EE_DESIGN.md §7, §8.2 to §8.4, §12 WP8): for every e2ee-active space whose
// replica this window runs, keep the readable copies the switches ask for, the reminder rows, apply what
// waits in the space's inbox and, on a manager's device, complete grants and key changes. They run while the
// device is unlocked; on the Mac only the window hosting a space's replica runs its workers. Starting them
// also hands the router WP8's Foli AI route (`aiRoute`).
import type { SyncOp } from "@folevi/editor-schema";
import { setup } from "../keys";
import { send } from "../compose/capture";
import { activeRouter, onActiveRouter } from "../router/active";
import type { E2eeRouterClient } from "../router/client";
import { scopeKeyOf, type E2eeSpace } from "../router/deps";
import { applyInbox } from "./inbox";
import { completeGrants } from "./grants";
import { forgetLocks, lockIndexFor } from "./locks";
import { mirrorOn, syncMirrors, type MirrorPurpose } from "./mirror";
import { syncReminders } from "./reminders";
import { aiRoute, resetConsent } from "./ai";

export { aiRoute, useAiConsent, askConsent, sealedChat, type ConsentRequest } from "./ai";
export { useRotationProgress } from "./grants";
export { fillNotificationTitles, previewsOn } from "./notifyPreview";

const DEBOUNCE_MS = 3_000;
const PERIOD_MS = 60_000;
const PURPOSES: MirrorPurpose[] = ["search", "ai", "apps"];

function profileIdOf(router: E2eeRouterClient): string {
  const personal = router.spaces.list().find((s) => s.scope.kind === "personal");
  return personal?.scopeId.startsWith("personal:") ? personal.scopeId.slice("personal:".length) : "";
}

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** One space's workers: one pass at a time, again after changes settle, and every minute. */
class SpaceWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval>;
  private running = false;
  private again = false;
  private offStore: (() => void) | null = null;
  private manager = true;
  private readonly sent = new Map<string, string>();
  private readonly applied = new Set<string>();
  private lastSwitches = "";

  constructor(
    private readonly router: E2eeRouterClient,
    private readonly key: string,
  ) {
    this.interval = setInterval(() => this.poke(0), PERIOD_MS);
    this.poke(0);
  }

  private space(): E2eeSpace | null {
    return this.router.spaces.list().find((s) => scopeKeyOf(s.scope) === this.key) ?? null;
  }

  /** Something changed (the replica, the switches): a pass soon. */
  poke(ms = DEBOUNCE_MS) {
    const space = this.space();
    if (space && !this.offStore) {
      const store = this.router.replicas.hostedStore?.(space.scope) ?? null;
      if (store) this.offStore = store.subscribe(() => this.poke());
    }
    if (space) {
      const sw = JSON.stringify([space.level, space.switches, space.lockedCount]);
      if (sw !== this.lastSwitches) {
        this.lastSwitches = sw;
        ms = 0;
      }
    }
    // A pass already waiting keeps its time (changes arriving all the time mustn't put it off forever).
    if (this.timer && ms > 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  private async run() {
    this.timer = null;
    if (this.running) {
      this.again = true;
      return;
    }
    const space = this.space();
    const env = this.router.env;
    if (!space || env.session.state() !== "unlocked") return;
    const store = this.router.replicas.hostedStore?.(space.scope) ?? null;
    if (!store || this.router.replicas.status(space.scope).state !== "ready") return;
    this.running = true;
    const locks = lockIndexFor(env.inner, () => this.space() ?? space);
    const isSealed = (id: string) => this.router.spaces.isSealed(id);
    const profileId = profileIdOf(this.router);
    try {
      for (const purpose of PURPOSES) if (mirrorOn(space, purpose)) await syncMirrors({ server: env.inner, space, store, locks, isSealed }, purpose).catch((e) => warn("copies", e));
      await syncReminders({ server: env.inner, space, store, locks, profileId, isSealed, sent: this.sent }).catch((e) => warn("reminders", e));
      if (space.level !== "standard") {
        await applyInbox({
          server: env.inner,
          keyring: env.keyring,
          space,
          store,
          profileId,
          timeZone: timeZone(),
          done: this.applied,
          send: (ops: SyncOp[], after, created) => send({ before: [], ops, after: after as never, createdDocuments: created }, space, env),
        }).catch((e) => warn("inbox", e));
        if (this.manager && space.scope.kind === "workspace") {
          this.manager = await completeGrants({ server: env.inner, space, completePendingGrants: (s) => setup.completePendingGrants(s), rotateSpace: (s, p) => setup.rotateSpace(s, p) }).catch((e) => {
            warn("grants", e);
            return true;
          });
        }
      }
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.poke();
      }
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    clearInterval(this.interval);
    this.offStore?.();
  }
}

function warn(what: string, e: unknown) {
  const code = (e as { data?: { code?: string } } | null)?.data?.code;
  console.warn(`[e2ee] The ${what} worker will try again: ${code ?? (e instanceof Error ? e.name : "error")}`);
}

/** §12 WP8: started by ProductApp once unlocked. Returns the stop. */
export function startFeatureWorkers(): () => void {
  const workers = new Map<string, SpaceWorker>();
  let router: E2eeRouterClient | null = null;
  let offs: (() => void)[] = [];

  const sync = () => {
    const r = activeRouter();
    if (r !== router) {
      for (const w of workers.values()) w.stop();
      workers.clear();
      for (const o of offs) o();
      offs = [];
      router?.setAiRouter(null);
      router = r;
      if (r) {
        // Foli AI per request (§7.2): the router's "ai" route.
        r.setAiRouter(aiRoute);
        offs.push(r.onRoutesChanged(() => sync()));
        offs.push(
          r.env.session.subscribe(() => {
            if (r.env.session.state() !== "unlocked") {
              forgetLocks();
              resetConsent();
            } else sync();
          }),
        );
      }
    }
    if (!router) return;
    const keys = new Set(router.spaces.list().map((s) => scopeKeyOf(s.scope)));
    for (const [k, w] of workers) if (!keys.has(k)) {
      w.stop();
      workers.delete(k);
    }
    for (const k of keys) {
      const w = workers.get(k);
      if (w) w.poke();
      else workers.set(k, new SpaceWorker(router, k));
    }
  };
  const offActive = onActiveRouter(sync);
  sync();
  return () => {
    offActive();
    router?.setAiRouter(null);
    for (const o of offs) o();
    for (const w of workers.values()) w.stop();
    workers.clear();
    forgetLocks();
    resetConsent();
  };
}
