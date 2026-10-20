// Account mode for the parity harness: the real Convex functions under convex-test, signed in as a fresh
// person with the helpers the Convex suite uses (tests/convex/helpers.ts). `person` bootstraps them, so
// their Personal holds the seed content, as local onboarding seeds it too.
import { getFunctionName, type FunctionReference } from "convex/server";
import { person, setup, type T } from "../../convex/helpers";
import type { ParityBackend } from "../types";

export const PARITY_EMAIL = "parity@example.com";
export const PARITY_DEVICE = "parity-device-1";

type Caller = Awaited<ReturnType<typeof person>>["as"];

export class ConvexDriver implements ParityBackend {
  readonly kind = "convex" as const;
  readonly scope = { kind: "personal" } as const;
  readonly deviceId = PARITY_DEVICE;
  readonly known = new Map<string, string>();
  readonly calls = new Set<string>();

  private constructor(
    readonly t: T,
    private readonly as: Caller,
    readonly profileId: string,
  ) {
    this.known.set(profileId, "<profile>");
    this.known.set(PARITY_DEVICE, "<device>");
  }

  static async open(): Promise<ConvexDriver> {
    const t = setup();
    const p = await person(t, PARITY_EMAIL);
    return new ConvexDriver(t, p.as, p.profileId);
  }

  private note(ref: FunctionReference<"query" | "mutation" | "action", "public">) {
    this.calls.add(getFunctionName(ref));
  }

  // convex-test types its callers with rest arguments (`...args: OptionalRestArgs<R>`); the contract takes
  // the args object directly, so the call goes through an untyped view. The public signature stays typed.
  async query<R extends FunctionReference<"query", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    return await (this.as.query as (r: R, a: unknown) => Promise<R["_returnType"]>)(ref, args);
  }

  async mutation<R extends FunctionReference<"mutation", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    return await (this.as.mutation as (r: R, a: unknown) => Promise<R["_returnType"]>)(ref, args);
  }

  async action<R extends FunctionReference<"action", "public">>(ref: R, args: R["_args"]): Promise<R["_returnType"]> {
    this.note(ref);
    return await (this.as.action as (r: R, a: unknown) => Promise<R["_returnType"]>)(ref, args);
  }

  /** Runs what's scheduled (repeatTask after a check-off) to the end, on the real clock. */
  async settle() {
    await this.t.finishAllScheduledFunctions(() => undefined);
  }

  async close() {}
}
