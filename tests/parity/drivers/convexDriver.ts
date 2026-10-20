// Account mode for the parity harness: the real Convex functions under convex-test, signed in as a fresh
// person with the helpers the Convex suite uses (tests/convex/helpers.ts). `person` bootstraps them, so
// their Personal holds the seed content, as local onboarding seeds it too.
import { getFunctionName, type FunctionReference } from "convex/server";
import { person, setup, type T } from "../../convex/helpers";
import { api } from "../../../convex/_generated/api";
import type { ParityBackend, UploadInput } from "../types";

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

  async upload(input: UploadInput): Promise<string> {
    const { intentId } = await this.mutation(api.files.generateUploadUrl, { scope: this.scope, documentId: input.documentId, filename: input.filename, size: input.bytes.length, mimeType: input.mimeType, kind: input.kind });
    // The POST to the upload address: convex-test has no HTTP storage endpoint, so the bytes go in directly.
    const storageId = await this.t.run(async (ctx) => await ctx.storage.store(new Blob([input.bytes as Uint8Array<ArrayBuffer>], { type: input.mimeType })));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input.bytes as Uint8Array<ArrayBuffer>));
    const sha256 = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    const result = await this.action(api.files.finalize, { intentId, storageId, sha256 });
    return result.fileId;
  }

  /** A link the server signed (`<site>/files/<id>?exp&sig`), fetched from its HTTP routes. */
  async download(url: string): Promise<Uint8Array> {
    const at = url.indexOf("/files/");
    if (at < 0) throw new Error(`not a file link: ${url}`);
    const res = await this.t.fetch(url.slice(at));
    if (!res.ok) throw new Error(`the file link answered ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async close() {}
}
