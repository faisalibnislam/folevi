// The router's route kinds and what each step gets (docs/E2EE_DESIGN.md §6.4, WP7).
import type { FunctionReference } from "convex/server";
import type { OpResult, SyncOp, WireScope } from "@folevi/editor-schema";
import type { SyncEngine } from "@/lib/sync/engine";
import type { Sealer } from "../seal";
import type { KeyRingLike, KeySessionLike } from "./deps";
import type { Resolution, SpaceIndex } from "./spaces";
import type { ReplicaHub } from "../replica/host";
import type { FileCache } from "../files";

export type CallKind = "query" | "mutation" | "action";

/** One call as the router sees it. */
export interface Call {
  /** "module:function" (Convex's own name, e2ee functions as "e2ee/keys:status"). */
  name: string;
  kind: CallKind;
  args: Record<string, unknown>;
  res: Resolution;
}

/** The plain Convex client underneath (a ConvexReactClient, or a test double). */
export interface InnerClient {
  query(ref: FunctionReference<"query">, args?: Record<string, unknown>): Promise<unknown>;
  mutation(ref: FunctionReference<"mutation">, args?: Record<string, unknown>, options?: unknown): Promise<unknown>;
  action(ref: FunctionReference<"action">, args?: Record<string, unknown>): Promise<unknown>;
}

/** What every route step can use. */
export interface RouterEnv {
  inner: InnerClient;
  sealer: Sealer;
  keyring: KeyRingLike;
  session: KeySessionLike;
  spaces: SpaceIndex;
  replicas: ReplicaHub;
  files: FileCache;
  /** The account's sync engine, when the app has one (composers queue their edits through it). */
  engine(): SyncEngine | null;
  /** Sends ops the way the engine's flush does, sealed (§6.6). For composers when there's no engine. */
  push(scope: WireScope, ops: SyncOp[]): Promise<OpResult[]>;
  /** Runs a call through the router again (a composer reading what a query would show). */
  call(kind: CallKind, name: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Opens the sealed parts of a Convex result, in place of the plaintext the caller expects. */
export type Decoder = (value: unknown, call: Call, env: RouterEnv) => Promise<unknown>;
/** Combines a Convex result (opened) with the replica's answer for the same call. */
export type Merger = (server: unknown, device: unknown, call: Call) => unknown;
/** The e2ee calls that stand for a plaintext mutation, and the result its caller expects from them. */
export type ArgSealer = (
  call: Call,
  env: RouterEnv,
) => Promise<{ calls: { ref: FunctionReference<"mutation">; args: Record<string, unknown> }[]; result: (results: unknown[]) => unknown }>;
/** A device implementation of a server mutation that derives plaintext (§6.7). */
export type Composer = (call: Call, env: RouterEnv) => Promise<unknown>;
/** Foli AI per request: switches, consent and provided context (§7.2, WP8). */
export type AiRouter = (call: Call, env: RouterEnv, forward: () => Promise<unknown>) => Promise<unknown>;

export type Route =
  /** No content: straight to Convex. */
  | { kind: "pass" }
  /** Convex, then open the sealed fields in the result. */
  | { kind: "decode"; open: Decoder }
  /**
   * The LocalBackend over the space's replica (encrypted spaces). In a Standard space with locked notes the
   * replica holds only those: `locks` says how the server's answer and the replica's combine there.
   * `serverToo`: part of the answer only the server has (a note's version activity), merged in everywhere.
   */
  | { kind: "device"; locks: "overlay" | "append"; merge?: Merger; serverToo?: boolean }
  /** Convex, open, then fill sealed entries from the replica (Standard spaces with locks). */
  | { kind: "overlay"; open: Decoder; merge: Merger }
  /** The Convex result plus the replica's hits (search, tasks, backlinks). */
  | { kind: "append"; merge: Merger }
  /** Seal the arguments and call the e2ee variant. */
  | { kind: "sealed"; to: FunctionReference<"mutation"> | null; seal: ArgSealer }
  /** A device implementation (reads the replica, writes through the engine and sealed calls). `personal`: a call
   * about the person's own Personal whatever its arguments say (onboarding). */
  | { kind: "compose"; run: Composer; personal?: true }
  /** Foli AI: feature switches and consent. */
  | { kind: "ai"; run?: AiRouter }
  /** Refused with e2ee_unavailable in an encrypted space. */
  | { kind: "off"; feature: string };
