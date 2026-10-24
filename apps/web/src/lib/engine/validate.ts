// Argument checks for bridge messages: a bad argument is refused with `invalid_args` and a sentence that says
// which one, before anything runs.
import type { BridgeErrorCode, EngineError } from "./protocol";

/** An error the bridge replies with (its code is a BridgeErrorCode or a server code). */
export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode | (string & {}),
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BridgeError";
  }
  toEngineError(): EngineError {
    return { code: this.code, message: this.message, ...(this.data ? { data: this.data } : {}) };
  }
}

export const invalid = (message: string): BridgeError => new BridgeError("invalid_args", message);

type Args = Record<string, unknown>;

/** The message's args as an object (a missing one is `{}`). */
export function argsOf(raw: unknown): Args {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid("args must be an object.");
  return raw as Args;
}

/** Ids and keys: short strings of letters, digits, `_`, `-`, `:` and `.`. */
const ID = /^[A-Za-z0-9_:.-]{1,128}$/;

export function id(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !ID.test(v)) throw invalid(`${key} must be an id.`);
  return v;
}

export function optionalId(args: Args, key: string): string | undefined {
  return args[key] === undefined ? undefined : id(args, key);
}

/** An id, null, or left out (undefined). */
export function nullableId(args: Args, key: string): string | null | undefined {
  if (args[key] === null) return null;
  return optionalId(args, key);
}

export function ids(args: Args, key = "ids", max = 500): string[] {
  const v = args[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && ID.test(x))) throw invalid(`${key} must be a list of note ids.`);
  if (!v.length) throw invalid(`${key} can't be empty.`);
  if (v.length > max) throw invalid(`At most ${max} ${key} at a time.`);
  return [...new Set(v as string[])];
}

export function text(args: Args, key: string, o: { max?: number; optional?: boolean; allowEmpty?: boolean } = {}): string | undefined {
  const v = args[key];
  if (v === undefined && o.optional) return undefined;
  if (typeof v !== "string") throw invalid(`${key} must be text.`);
  if (!o.allowEmpty && !v.trim()) throw invalid(`${key} can't be empty.`);
  if (v.length > (o.max ?? 10_000)) throw invalid(`${key} is too long.`);
  return v;
}

export function bool(args: Args, key: string, fallback?: boolean): boolean {
  const v = args[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== "boolean") throw invalid(`${key} must be true or false.`);
  return v;
}

export function num(args: Args, key: string, o: { min?: number; max?: number; fallback?: number } = {}): number {
  const v = args[key];
  if (v === undefined && o.fallback !== undefined) return o.fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) throw invalid(`${key} must be a number.`);
  if (o.min !== undefined && v < o.min) throw invalid(`${key} must be at least ${o.min}.`);
  if (o.max !== undefined && v > o.max) throw invalid(`${key} must be at most ${o.max}.`);
  return v;
}

export function oneOf<T extends string>(args: Args, key: string, values: readonly T[], fallback?: T): T {
  const v = args[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) throw invalid(`${key} must be one of ${values.join(", ")}.`);
  return v as T;
}

/** Refuses keys the contract doesn't know (a typo shouldn't be quietly ignored). */
export function only(args: Args, keys: readonly string[]): void {
  for (const k of Object.keys(args)) if (!keys.includes(k)) throw invalid(`Unknown argument “${k}”.`);
}
