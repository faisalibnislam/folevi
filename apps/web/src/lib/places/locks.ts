// One runner per account in the browser (docs/MULTI_ACCOUNT_PLAN.md §5.1). A tab showing an account holds the
// Web Lock `folevi-place:<user id>` in shared mode for as long as it shows it; a background runner asks for it
// exclusively, so it only runs while no tab shows that account, and it steps aside as soon as one wants it again.

const name = (userId: string) => `folevi-place:${userId}`;

type Locks = Pick<LockManager, "request" | "query">;
const locks = (): Locks | null => (typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null);

/** Holds the shared lock while the returned function hasn't been called. */
export function holdPlaceOpen(userId: string, manager: Locks | null = locks()): () => void {
  if (!manager) return () => {};
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const ctrl = new AbortController();
  void manager.request(name(userId), { mode: "shared", signal: ctrl.signal }, () => held).catch(() => undefined);
  return () => {
    ctrl.abort();
    release();
  };
}

/**
 * Runs `start` while this tab holds the account's exclusive lock (no tab shows the account). `start` returns its
 * own stop. Every `checkMs` the runner looks for a tab waiting to show the account and steps aside, then queues
 * again. Returns the function that ends it all.
 */
export function runWhileNotOpen(userId: string, start: () => () => void, o: { manager?: Locks | null; checkMs?: number } = {}): () => void {
  const manager = o.manager === undefined ? locks() : o.manager;
  if (!manager) {
    // Without Web Locks (very old browsers) every tab runs it: duplicates are harmless, just noisy.
    return start();
  }
  let ended = false;
  let ctrl: AbortController | null = null;
  const loop = async () => {
    while (!ended) {
      ctrl = new AbortController();
      try {
        const signal = ctrl.signal;
        await manager.request(name(userId), { mode: "exclusive", signal }, async () => {
          const stop = start();
          try {
            await new Promise<void>((resolve) => {
              const done = () => {
                clearInterval(timer);
                resolve();
              };
              const timer = setInterval(async () => {
                if (ended) return done();
                const state = await manager.query().catch(() => null);
                // A tab that wants to show this account is waiting for the lock: hand it over.
                if (state?.pending?.some((l) => l.name === name(userId) && l.mode === "shared")) done();
              }, o.checkMs ?? 3000);
              // (Aborting a granted request doesn't release it: the runner lets go itself.)
              signal.addEventListener("abort", done, { once: true });
            });
          } finally {
            stop();
          }
        });
      } catch {
        // Aborted (ended), or the lock manager went away: stop.
        if (ended) return;
      }
      // Stepped aside: wait until no tab shows it any more (the shared holders release), then run again.
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  void loop();
  return () => {
    ended = true;
    ctrl?.abort();
  };
}
