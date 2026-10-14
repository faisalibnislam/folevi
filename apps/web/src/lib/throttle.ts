/**
 * Calls `fn` at most once every `wait` ms with the latest arguments: the first call goes at once, calls
 * during the wait are folded into one at its end (so the last value is always sent). `cancel` drops a call
 * still waiting; `flush` sends it now.
 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = () => {
    timer = null;
    if (!pending) return;
    const args = pending;
    pending = null;
    last = Date.now();
    fn(...args);
  };
  const call = (...args: A) => {
    pending = args;
    if (timer) return;
    const due = last + wait - Date.now();
    if (due <= 0) run();
    else timer = setTimeout(run, due);
  };
  call.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  call.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  return call;
}
