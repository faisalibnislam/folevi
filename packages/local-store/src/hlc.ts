// Hybrid logical clocks (LOCAL_MODE_PLAN.md §3.2).
//
// An HLC is the string `<ms base36, 9 chars>-<counter base36, 4 chars>-<deviceId>`. Fixed-width lowercase
// base36 makes plain string comparison the total order, with the device id as the final tie-break.

export const HLC_MS_WIDTH = 9;
export const HLC_COUNTER_WIDTH = 4;
const MAX_COUNTER = 36 ** HLC_COUNTER_WIDTH - 1;
const MAX_MS = 36 ** HLC_MS_WIDTH - 1;

/** The local clock is never advanced past wall time plus this, whatever a remote clock says. */
export const MAX_FORWARD_DRIFT_MS = 5 * 60_000;
/** A remote clock this far ahead of local wall time is reported as a severe skew. */
export const SEVERE_SKEW_MS = 24 * 60 * 60_000;

/** Device ids are used inside HLCs and file names, so they are plain word characters (no dashes). */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

const HLC_PATTERN = new RegExp(
  `^([0-9a-z]{${HLC_MS_WIDTH}})-([0-9a-z]{${HLC_COUNTER_WIDTH}})-([A-Za-z0-9_]{1,64})$`,
);

export class HlcError extends Error {
  override name = "HlcError";
}

export interface ParsedHlc {
  ms: number;
  counter: number;
  deviceId: string;
}

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
}

export function formatHlc(p: ParsedHlc): string {
  if (!Number.isInteger(p.ms) || p.ms < 0 || p.ms > MAX_MS)
    throw new HlcError(`HLC time out of range: ${p.ms}`);
  if (!Number.isInteger(p.counter) || p.counter < 0 || p.counter > MAX_COUNTER)
    throw new HlcError(`HLC counter out of range: ${p.counter}`);
  if (!isDeviceId(p.deviceId))
    throw new HlcError(`Invalid device id: ${JSON.stringify(p.deviceId)}`);
  return `${p.ms.toString(36).padStart(HLC_MS_WIDTH, "0")}-${p.counter.toString(36).padStart(HLC_COUNTER_WIDTH, "0")}-${p.deviceId}`;
}

export function isHlc(value: unknown): value is string {
  return typeof value === "string" && HLC_PATTERN.test(value);
}

export function parseHlc(value: string): ParsedHlc {
  const m = HLC_PATTERN.exec(value);
  if (!m) throw new HlcError(`Invalid HLC: ${JSON.stringify(value)}`);
  return { ms: parseInt(m[1]!, 36), counter: parseInt(m[2]!, 36), deviceId: m[3]! };
}

/** Wall-clock milliseconds of an HLC. */
export function hlcMs(value: string): number {
  return parseHlc(value).ms;
}

/** The device that issued an HLC. */
export function hlcDevice(value: string): string {
  return parseHlc(value).deviceId;
}

/** Total order. `null`, `undefined` and "" sort before every clock. */
export function compareHlc(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

export function maxHlc(...values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (best === null || v > best)) best = v;
  return best;
}

/** The smallest clock of `deviceId` that sorts after `after` (used when a stamp must beat an observed one). */
export function hlcSuccessor(after: string, deviceId: string): string {
  const p = parseHlc(after);
  if (p.counter < MAX_COUNTER) return formatHlc({ ms: p.ms, counter: p.counter + 1, deviceId });
  return formatHlc({ ms: p.ms + 1, counter: 0, deviceId });
}

export interface SkewReport {
  remote: string;
  /** How far the remote clock is ahead of local wall time. */
  aheadMs: number;
  /** More than `SEVERE_SKEW_MS` ahead. */
  severe: boolean;
}

export interface HybridClockOptions {
  /** Wall time source; defaults to Date.now. */
  now?: () => number;
  maxForwardDriftMs?: number;
  /** Called when a remote clock is ahead of wall time by more than the drift cap (it is still accepted as data). */
  onSkew?: (report: SkewReport) => void;
  /** The last clock this device issued (persisted across launches). */
  last?: string | null;
}

/**
 * The device's clock. `tick()` issues strictly increasing stamps; `receive()` folds in remote stamps so later
 * local stamps sort after them, but never moves the clock past `now + maxForwardDriftMs`: one device with a
 * skewed clock can't make every later edit lose. Version vectors decide causality, so a skewed device only
 * ever wins ties between concurrent edits.
 */
export class HybridClock {
  readonly deviceId: string;
  private ms = 0;
  private counter = -1;
  private readonly now: () => number;
  private readonly maxDrift: number;
  private readonly onSkew?: (report: SkewReport) => void;

  constructor(deviceId: string, options: HybridClockOptions = {}) {
    if (!isDeviceId(deviceId)) throw new HlcError(`Invalid device id: ${JSON.stringify(deviceId)}`);
    this.deviceId = deviceId;
    this.now = options.now ?? (() => Date.now());
    this.maxDrift = options.maxForwardDriftMs ?? MAX_FORWARD_DRIFT_MS;
    this.onSkew = options.onSkew;
    if (options.last) {
      const p = parseHlc(options.last);
      this.ms = p.ms;
      this.counter = p.counter;
    }
  }

  /** The last stamp issued, or null. */
  peek(): string | null {
    return this.counter < 0
      ? null
      : formatHlc({ ms: this.ms, counter: this.counter, deviceId: this.deviceId });
  }

  /** A new stamp, greater than every stamp issued or received (within the drift cap). */
  tick(): string {
    const wall = Math.floor(this.now());
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else if (this.counter >= MAX_COUNTER) {
      this.ms += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return formatHlc({ ms: this.ms, counter: this.counter, deviceId: this.deviceId });
  }

  /**
   * A new stamp that also sorts after `observed`, even when `observed` is past the drift cap. For last-writer-wins
   * registers without a version vector (tags, positions), so a deliberate local change after seeing a skewed
   * stamp still wins.
   */
  tickAfter(...observed: (string | null | undefined)[]): string {
    const stamp = this.tick();
    const top = maxHlc(...observed);
    if (top === null || stamp > top) return stamp;
    const next = hlcSuccessor(top, this.deviceId);
    const p = parseHlc(next);
    this.ms = p.ms;
    this.counter = p.counter;
    return next;
  }

  /** Folds a remote stamp into the clock. */
  receive(remote: string): void {
    const r = parseHlc(remote);
    const wall = Math.floor(this.now());
    const cap = wall + this.maxDrift;
    let ms = r.ms;
    let counter = r.counter;
    if (r.ms > cap) {
      this.onSkew?.({ remote, aheadMs: r.ms - wall, severe: r.ms - wall > SEVERE_SKEW_MS });
      ms = cap;
      counter = 0;
    }
    if (ms > this.ms) {
      this.ms = ms;
      this.counter = counter;
    } else if (ms === this.ms && counter > this.counter) {
      this.counter = counter;
    }
  }
}
