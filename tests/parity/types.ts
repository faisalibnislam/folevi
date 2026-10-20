// The parity harness (docs/LOCAL_MODE_PLAN.md §2.5, WP8a): the same scenarios run against account mode
// (Convex, through convex-test) and local mode (LocalBackend over an in-memory library), and their
// normalized results must be equal.
//
// Adding a scenario (WP7a-e, WP8b):
//   1. Put it in tests/parity/scenarios/<module>.ts (one file per area; a file exports `scenarios`).
//   2. Write it against `ParityBackend` only (`b.query`, `b.mutation`, `b.action` with real `api.*`
//      references) and the kit (`k.id`, `k.newNote`, `k.push`, ...). No `t.run`, no database reads: both
//      backends have to be able to answer it.
//   3. Return what the person would see (the query results that matter). The runner normalizes it
//      (normalize.ts) and compares the two backends.
//   4. While the local handlers don't exist, set `localPending` to the work package that ports them. The
//      scenario then runs against Convex only. Remove it when the handlers land; `PARITY_TRY_PENDING=1`
//      runs pending scenarios against local mode too, to see which already pass.
//   5. Where the modes differ on purpose (plan §2.3: local sync.push never answers `conflict`), set
//      `accountOnly` to the reason instead. Keep those few and say why.
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import type { Kit } from "./kit";

export type BackendKind = "convex" | "local";

/** The driver contract: what a scenario may call. Both drivers implement it. */
export interface Backend {
  readonly kind: BackendKind;
  query<R extends FunctionReference<"query", "public">>(ref: R, args: FunctionArgs<R>): Promise<FunctionReturnType<R>>;
  mutation<R extends FunctionReference<"mutation", "public">>(ref: R, args: FunctionArgs<R>): Promise<FunctionReturnType<R>>;
  action<R extends FunctionReference<"action", "public">>(ref: R, args: FunctionArgs<R>): Promise<FunctionReturnType<R>>;
}

/** A driver signed in as one person in their Personal, the only scope local mode has. */
export interface ParityBackend extends Backend {
  readonly scope: { kind: "personal" };
  /** The device id ops are pushed with. */
  readonly deviceId: string;
  /** Values the normalizer replaces with a name (the person's profile id, the device id, ids a scenario named). */
  readonly known: Map<string, string>;
  /** Every function name ("documents:get") the scenario called, for coverage hints. */
  readonly calls: Set<string>;
  close(): Promise<void>;
}

export interface Scenario {
  name: string;
  /**
   * Set while local mode can't run it yet: the work package that ports what it calls (for example
   * "WP7a: sync.push, documents.get"). It then runs against Convex only.
   */
  localPending?: string;
  /**
   * Set when the modes differ by design (for example, local mode never answers `conflict`): why. The
   * scenario then runs against Convex only, permanently, and documents the account-mode behaviour.
   */
  accountOnly?: string;
  /** Keys (anywhere in the result) dropped before comparing: fields that legitimately differ by mode. */
  ignore?: string[];
  run(b: ParityBackend, k: Kit): Promise<unknown>;
}

export function scenario(s: Scenario): Scenario {
  return s;
}
