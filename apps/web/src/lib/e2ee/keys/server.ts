// The server calls the key code makes (docs/E2EE_DESIGN.md §5.3: e2ee.keys, devices, spaces, grants, and the
// note key pages of e2ee.pull), behind one small interface so the unit tests run against a fake server
// (test/e2ee/fakeKeysServer.ts) and the app against Convex. Results are the server's own types.
import { makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";

type Q<F extends FunctionReference<"query">> = (args: FunctionArgs<F>) => Promise<FunctionReturnType<F>>;
type M<F extends FunctionReference<"mutation">> = (args: FunctionArgs<F>) => Promise<FunctionReturnType<F>>;

const k = api.e2ee.keys;
const d = api.e2ee.devices;
const s = api.e2ee.spaces;
const g = api.e2ee.grants;

/** A note key wrap as e2ee.pull (WP3) and e2ee.grants.myNoteKeys return it. */
export interface NoteKeyRow {
  documentId: string;
  version: number;
  wrappedBy: "space" | "grant" | "link";
  spaceVersion?: number | null;
  wrapped: ArrayBuffer;
}

/** WP3's pull, read only for its note keys (a space rotation re-wraps every note's key). */
export const pullNoteKeysRef = makeFunctionReference<
  "query",
  { scope: { kind: "personal" } | { kind: "workspace"; workspaceId: string }; cursor: number; limit?: number },
  { noteKeys: NoteKeyRow[]; nextCursor: number; hasMore: boolean }
>("e2ee/pull:pull");

export type AccountStatus = FunctionReturnType<typeof k.status>;
export type WrapListRow = FunctionReturnType<typeof k.listWraps>[number];
export type WrapRow = NonNullable<FunctionReturnType<typeof k.getWrap>>;
export type DeviceRow = FunctionReturnType<typeof d.list>[number];
export type ApprovalListRow = FunctionReturnType<typeof d.approvals>[number];
export type ApprovalRow = NonNullable<FunctionReturnType<typeof d.approval>>;
export type MySpace = FunctionReturnType<typeof s.mine>[number];
export type SpaceRow = FunctionReturnType<typeof s.get>;
export type AccountKeysRow = FunctionReturnType<typeof k.accountKeysOf>[number];
export type PendingRow = FunctionReturnType<typeof g.pending>[number];
export type AudienceRow = FunctionReturnType<typeof g.noteAudience>[number];

export interface KeysServer {
  keys: {
    status: Q<typeof k.status>;
    createAccount: M<typeof k.createAccount>;
    addWrap: M<typeof k.addWrap>;
    removeWrap: M<typeof k.removeWrap>;
    listWraps: Q<typeof k.listWraps>;
    getWrap: M<typeof k.getWrap>;
    getDeviceWrap: Q<typeof k.getDeviceWrap>;
    rotateAccount: M<typeof k.rotateAccount>;
    resetAccount: M<typeof k.resetAccount>;
    accountKeysOf: Q<typeof k.accountKeysOf>;
  };
  devices: {
    register: M<typeof d.register>;
    requestApproval: M<typeof d.requestApproval>;
    answerApproval: M<typeof d.answerApproval>;
    revealApproval: M<typeof d.revealApproval>;
    completeApproval: M<typeof d.completeApproval>;
    cancelApproval: M<typeof d.cancelApproval>;
    approval: Q<typeof d.approval>;
    list: Q<typeof d.list>;
    touch: M<typeof d.touch>;
  };
  spaces: {
    get: Q<typeof s.get>;
    mine: Q<typeof s.mine>;
    setUp: M<typeof s.setUp>;
    rotate: M<typeof s.rotate>;
    addNoteKeyWraps: M<typeof s.addNoteKeyWraps>;
    keyHolders: Q<typeof s.keyHolders>;
  };
  grants: {
    grantSpace: M<typeof g.grantSpace>;
    pending: Q<typeof g.pending>;
    grantNote: M<typeof g.grantNote>;
    noteAudience: Q<typeof g.noteAudience>;
    myNoteKeys: Q<typeof g.myNoteKeys>;
  };
  pullNoteKeys(args: FunctionArgs<typeof pullNoteKeysRef>): Promise<FunctionReturnType<typeof pullNoteKeysRef>>;
  /** Live results: the approvals waiting for this account, one approval, the ways to unlock. Returns the unsubscribe. */
  watchApprovals(cb: (rows: ApprovalListRow[]) => void): () => void;
  watchApproval(requestId: string, cb: (row: ApprovalRow | null) => void): () => void;
  watchWraps(cb: (rows: WrapListRow[]) => void): () => void;
  watchStatus(cb: (status: AccountStatus) => void): () => void;
}

/** What the key code needs of a ConvexReactClient. */
export interface ConvexLike {
  query(ref: FunctionReference<"query">, args: Record<string, unknown>): Promise<unknown>;
  mutation(ref: FunctionReference<"mutation">, args: Record<string, unknown>): Promise<unknown>;
  watchQuery(ref: FunctionReference<"query">, args: Record<string, unknown>): { onUpdate(cb: () => void): () => void; localQueryResult(): unknown };
}

export function convexKeysServer(client: ConvexLike): KeysServer {
  const q =
    <F extends FunctionReference<"query">>(ref: F): Q<F> =>
    (args) =>
      client.query(ref, args as Record<string, unknown>) as Promise<FunctionReturnType<F>>;
  const m =
    <F extends FunctionReference<"mutation">>(ref: F): M<F> =>
    (args) =>
      client.mutation(ref, args as Record<string, unknown>) as Promise<FunctionReturnType<F>>;
  const watch = <T>(ref: FunctionReference<"query">, args: Record<string, unknown>, cb: (v: T) => void) => {
    const w = client.watchQuery(ref, args);
    const read = () => {
      let value: unknown;
      try {
        value = w.localQueryResult();
      } catch {
        // An error result (signed out, a failed query): keep the last answer.
        return;
      }
      if (value !== undefined) cb(value as T);
    };
    const off = w.onUpdate(read);
    read();
    return off;
  };
  return {
    keys: {
      status: q(k.status),
      createAccount: m(k.createAccount),
      addWrap: m(k.addWrap),
      removeWrap: m(k.removeWrap),
      listWraps: q(k.listWraps),
      getWrap: m(k.getWrap),
      getDeviceWrap: q(k.getDeviceWrap),
      rotateAccount: m(k.rotateAccount),
      resetAccount: m(k.resetAccount),
      accountKeysOf: q(k.accountKeysOf),
    },
    devices: {
      register: m(d.register),
      requestApproval: m(d.requestApproval),
      answerApproval: m(d.answerApproval),
      revealApproval: m(d.revealApproval),
      completeApproval: m(d.completeApproval),
      cancelApproval: m(d.cancelApproval),
      approval: q(d.approval),
      list: q(d.list),
      touch: m(d.touch),
    },
    spaces: {
      get: q(s.get),
      mine: q(s.mine),
      setUp: m(s.setUp),
      rotate: m(s.rotate),
      addNoteKeyWraps: m(s.addNoteKeyWraps),
      keyHolders: q(s.keyHolders),
    },
    grants: {
      grantSpace: m(g.grantSpace),
      pending: q(g.pending),
      grantNote: m(g.grantNote),
      noteAudience: q(g.noteAudience),
      myNoteKeys: q(g.myNoteKeys),
    },
    pullNoteKeys: q(pullNoteKeysRef),
    watchApprovals: (cb) => watch(d.approvals, {}, cb),
    watchApproval: (requestId, cb) => watch(d.approval, { requestId }, cb),
    watchWraps: (cb) => watch(k.listWraps, {}, cb),
    watchStatus: (cb) => watch(k.status, {}, cb),
  };
}
