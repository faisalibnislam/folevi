// An in-memory stand-in for WP2's e2ee.keys / devices / spaces / grants (convex/e2ee/*.ts), with the same
// argument and result shapes and the rules the client depends on: client-chosen wrap ids, one recovery key
// and one passphrase per epoch, device wraps only for registered non-session devices, the unlock rate limit,
// the approval relay, grants only to members, pending rows. It never opens or verifies anything sealed.
// Each person gets a view with `fake.as(profileId)`; watchers re-run after every mutation.
import { verifyStatement } from "@folevi/local-store/e2ee";
import type { KeysServer } from "@/lib/e2ee/keys/server";

type Bytes = ArrayBuffer;
type Statement = { kind: string; body: string; sig: string };
type Scope = { kind: "personal" } | { kind: "workspace"; workspaceId: string };

interface Account { profileId: string; epoch: number; x25519Pub: Bytes; ed25519Pub: Bytes; amkCheck: Bytes; statement: Statement; status: "active" | "superseded" }
interface Wrap { publicId: string; profileId: string; epoch: number; kind: "device" | "recoveryKey" | "passkey" | "passphrase"; deviceId?: string; credentialId?: string; prfSalt?: Bytes; kdf?: { name: "argon2id"; m: number; t: number; p: number; salt: Bytes }; wrapped: Bytes; label?: string; createdAt: number; lastUsedAt?: number }
interface Device { profileId: string; deviceId: string; kind: "app" | "browser" | "session"; label: string; platform: string; x25519Pub: Bytes; ed25519Pub: Bytes; status: "pending" | "trusted" | "revoked"; statement?: Statement; createdAt: number; lastSeenAt: number }
interface Approval { publicId: string; profileId: string; deviceId: string; commit: Bytes; status: "waiting" | "answered" | "revealed" | "done" | "cancelled" | "expired"; approverDeviceId?: string; approverNonce?: Bytes; requesterNonce?: Bytes; wrapped?: Bytes; createdAt: number; expiresAt: number }
interface Space { scopeKey: string; level: "standard" | "selected" | "full"; state: "off" | "enabling" | "on" | "disabling"; currentKeyVersion: number; lockedCount: number; seq: number }
interface Grant { scopeKey: string; version: number; profileId: string; epoch: number; wrapped: Bytes; statement: Statement; grantedBy: string }
interface NoteKey { documentId: string; scopeKey: string; version: number; wrappedBy: "space" | "grant" | "link"; spaceVersion?: number; profileId?: string; wrapped: Bytes; statement?: Statement; createdBy: string; seq: number }
interface Pending { scopeKey: string; profileId: string; reason: "joined" | "reset" | "rotation" | "page"; documentId?: string; createdAt: number }

export class ConvexLikeError extends Error {
  constructor(readonly data: { code: string; message?: string }) {
    super(data.message ?? data.code);
  }
}
const fail = (code: string, message?: string): never => {
  throw new ConvexLikeError({ code, message });
};

const SWITCHES = { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false } as const;

let ids = 0;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function fakeUlid(): string {
  ids++;
  let s = "";
  let n = ids;
  for (let i = 0; i < 26; i++) {
    s = CROCKFORD[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
}
const isUlid = (s: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);

function body(s: Statement): Record<string, unknown> {
  return JSON.parse(s.body) as Record<string, unknown>;
}
/** As WP2's requireSigned: the statement must verify against the account key. */
async function signed(pub: Bytes, st: Statement): Promise<void> {
  if (!(await verifyStatement(new Uint8Array(pub), st as Parameters<typeof verifyStatement>[1]))) fail("invalid_argument", "The statement isn't signed by your encryption key.");
}
function b64u(b: Bytes): string {
  return Buffer.from(new Uint8Array(b)).toString("base64url");
}

export class FakeKeysServer {
  now = 1_700_000_000_000;
  accounts: Account[] = [];
  wraps: Wrap[] = [];
  devices: Device[] = [];
  approvals: Approval[] = [];
  spaces = new Map<string, Space>();
  spaceKeys: { scopeKey: string; version: number; inboxPub: Bytes; skCheck: Bytes; retiredAt?: number }[] = [];
  grants: Grant[] = [];
  noteKeys: NoteKey[] = [];
  pending: Pending[] = [];
  /** workspace id → members. */
  workspaces = new Map<string, { profileId: string; role: "owner" | "admin" | "member" }[]>();
  unlockAttempts = new Map<string, number>();
  calls: string[] = [];
  /** Tests: rewrites what the approvals list returns (a server substituting keys). */
  tamperApprovals: ((rows: ReturnType<FakeKeysServer["approvalRows"]>) => ReturnType<FakeKeysServer["approvalRows"]>) | null = null;
  tamperApproval: ((row: NonNullable<ReturnType<FakeKeysServer["approvalRow"]>>) => NonNullable<ReturnType<FakeKeysServer["approvalRow"]>>) | null = null;
  private watchers = new Set<() => void>();
  private seq = 0;

  private notify() {
    // Like Convex: subscribers hear about it after the mutation returns.
    queueMicrotask(() => {
      for (const w of [...this.watchers]) w();
    });
  }

  active(profileId: string): Account | null {
    const list = this.accounts.filter((a) => a.profileId === profileId).sort((a, b) => b.epoch - a.epoch);
    return list[0]?.status === "active" ? list[0] : null;
  }
  private scopeKeyOf(scope: Scope, me: string): string {
    return scope.kind === "personal" ? `personal:${me}` : `workspace:${scope.workspaceId}`;
  }
  private members(scopeKey: string): { profileId: string; manager: boolean }[] {
    if (scopeKey.startsWith("personal:")) return [{ profileId: scopeKey.slice(9), manager: true }];
    return (this.workspaces.get(scopeKey.slice(10)) ?? []).map((m) => ({ profileId: m.profileId, manager: m.role !== "member" }));
  }
  private requireManager(scopeKey: string, me: string) {
    if (!this.members(scopeKey).some((m) => m.profileId === me && m.manager)) fail("forbidden", "Only owners and admins.");
  }
  private methodKinds(profileId: string, epoch: number, without?: string): Set<string> {
    const wraps = this.wraps.filter((w) => w.profileId === profileId && w.epoch === epoch && w.publicId !== without);
    const kinds = new Set<string>();
    for (const w of wraps) if (w.kind !== "device") kinds.add(w.kind);
    const trusted = new Set(this.devices.filter((d) => d.profileId === profileId && d.status === "trusted" && d.kind !== "session").map((d) => d.deviceId));
    if (new Set(wraps.filter((w) => w.kind === "device" && trusted.has(w.deviceId!)).map((w) => w.deviceId)).size >= 2) kinds.add("device");
    return kinds;
  }
  private storeWrap(profileId: string, epoch: number, w: Omit<Wrap, "publicId" | "profileId" | "epoch" | "createdAt"> & { wrapId?: string }): string {
    if (w.kind === "device") {
      const d = this.devices.find((x) => x.profileId === profileId && x.deviceId === w.deviceId);
      if (!d || d.status === "revoked") fail("not_found", "Device not found.");
      if (d!.kind === "session") fail("invalid_argument", "A public session doesn't keep a wrapped key.");
    }
    if (w.kind === "passphrase" && (!w.kdf || w.kdf.salt.byteLength !== 16)) fail("invalid_argument", "kdf");
    const publicId = w.wrapId ?? fakeUlid();
    if (!isUlid(publicId)) fail("invalid_argument", "The wrap id isn't valid.");
    this.wraps = this.wraps.filter(
      (o) =>
        !(
          o.profileId === profileId &&
          o.epoch === epoch &&
          o.kind === w.kind &&
          (w.kind === "recoveryKey" || w.kind === "passphrase" || (w.kind === "device" && o.deviceId === w.deviceId) || (w.kind === "passkey" && o.credentialId === w.credentialId))
        ),
    );
    const { wrapId: _drop, ...rest } = w;
    void _drop;
    this.wraps.push({ ...rest, publicId, profileId, epoch, createdAt: this.now });
    return publicId;
  }
  private upsertDevice(profileId: string, d: { deviceId: string; kind: Device["kind"]; label: string; platform: string; x25519Pub: Bytes; ed25519Pub: Bytes; statement?: Statement }, status: Device["status"]) {
    const existing = this.devices.find((x) => x.profileId === profileId && x.deviceId === d.deviceId);
    if (existing?.status === "revoked") fail("forbidden", "This device was removed from your account.");
    if (existing) Object.assign(existing, { ...d, status, statement: d.statement ?? existing.statement, lastSeenAt: this.now });
    else this.devices.push({ profileId, ...d, status, createdAt: this.now, lastSeenAt: this.now });
  }
  approvalRows(me: string) {
    return this.approvals
      .filter((a) => a.profileId === me && ["waiting", "answered", "revealed"].includes(a.status) && a.expiresAt > this.now)
      .map((a) => {
        const d = this.devices.find((x) => x.profileId === me && x.deviceId === a.deviceId)!;
        return {
          requestId: a.publicId,
          status: a.status as "waiting" | "answered" | "revealed",
          deviceId: a.deviceId,
          kind: d.kind,
          label: d.label,
          platform: d.platform,
          x25519Pub: d.x25519Pub,
          ed25519Pub: d.ed25519Pub,
          commit: a.commit,
          approverDeviceId: a.approverDeviceId ?? null,
          approverNonce: a.approverNonce ?? null,
          requesterNonce: a.requesterNonce ?? null,
          createdAt: a.createdAt,
          expiresAt: a.expiresAt,
        };
      });
  }
  approvalRow(me: string, requestId: string) {
    const a = this.approvals.find((x) => x.publicId === requestId && x.profileId === me);
    if (!a) return null;
    const approver = a.approverDeviceId ? this.devices.find((d) => d.profileId === me && d.deviceId === a.approverDeviceId) : null;
    return {
      requestId: a.publicId,
      status: a.status,
      deviceId: a.deviceId,
      approverDeviceId: a.approverDeviceId ?? null,
      approverEd25519Pub: approver?.ed25519Pub ?? null,
      approverNonce: a.approverNonce ?? null,
      wrapped: a.status === "done" ? (a.wrapped ?? null) : null,
      expiresAt: a.expiresAt,
    };
  }
  private openApproval(me: string, requestId: string): Approval {
    const a = this.approvals.find((x) => x.publicId === requestId && x.profileId === me);
    if (!a || !["waiting", "answered", "revealed"].includes(a.status)) fail("expired", "This request has ended.");
    return a!;
  }
  private async storeGrants(scopeKey: string, granter: string, grants: { profileId: string; version: number; epoch: number; wrapped: Bytes; statement: Statement }[]) {
    for (const g of grants) {
      await signed((this.active(granter) ?? fail("conflict")).ed25519Pub, g.statement);
      if (!this.members(scopeKey).some((m) => m.profileId === g.profileId)) fail("forbidden", "Keys can only be shared with people in this space.");
      const acct = this.accounts.find((a) => a.profileId === g.profileId && a.epoch === g.epoch && a.status === "active");
      if (!acct) fail("conflict", "That person's encryption keys changed.");
      const b = body(g.statement);
      if (b.scope !== scopeKey || b.version !== g.version || b.profileId !== g.profileId || b.granteeX25519Pub !== b64u(acct!.x25519Pub) || b.grantedBy !== granter) fail("invalid_argument", "The statement doesn't match.");
      this.grants = this.grants.filter((x) => !(x.scopeKey === scopeKey && x.profileId === g.profileId && x.version === g.version && x.epoch === g.epoch));
      this.grants.push({ scopeKey, ...g, grantedBy: granter });
      this.pending = this.pending.filter((p) => !(p.scopeKey === scopeKey && p.profileId === g.profileId && (p.reason === "joined" || p.reason === "reset")));
    }
  }

  /** The KeysServer one person's client sees. */
  as(me: string): KeysServer {
    // The views below are plain objects whose methods run against this one fake.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const q =
      <A, R>(name: string, fn: (a: A) => R) =>
      async (a: A): Promise<R> => {
        self.calls.push(name);
        return structuredClone(fn(a));
      };
    const m =
      <A, R>(name: string, fn: (a: A) => R | Promise<R>) =>
      async (a: A): Promise<R> => {
        self.calls.push(name);
        const r = await fn(structuredClone(a));
        self.notify();
        return r;
      };
    const watch = <T>(name: string, read: () => T, cb: (v: T) => void) => {
      self.calls.push(`watch.${name}`);
      const run = () => cb(structuredClone(read()));
      self.watchers.add(run);
      queueMicrotask(run);
      return () => {
        self.watchers.delete(run);
      };
    };
    const status = () => {
      const a = self.active(me);
      const devices = self.devices.filter((d) => d.profileId === me && d.status === "trusted").length;
      if (!a) return { setUp: false as const, epoch: null, x25519Pub: null, ed25519Pub: null, amkCheck: null, statement: null, methods: [] as string[], devices, holdsEncryptedSpace: false };
      return { setUp: true as const, epoch: a.epoch, x25519Pub: a.x25519Pub, ed25519Pub: a.ed25519Pub, amkCheck: a.amkCheck, statement: a.statement, methods: [...self.methodKinds(me, a.epoch)].sort(), devices, holdsEncryptedSpace: false };
    };
    const listWraps = () => {
      const a = self.active(me);
      if (!a) return [];
      return self.wraps
        .filter((w) => w.profileId === me && w.epoch === a.epoch)
        .map((w) => ({ publicId: w.publicId, kind: w.kind, label: w.label ?? null, deviceId: w.deviceId ?? null, credentialId: w.credentialId ?? null, prfSalt: w.prfSalt ?? null, createdAt: w.createdAt, lastUsedAt: w.lastUsedAt ?? null }));
    };
    const requireAccount = () => self.active(me) ?? fail("e2ee_not_set_up");
    const server = {
      keys: {
        status: q("keys.status", status),
        createAccount: m("keys.createAccount", async (a: { x25519Pub: Bytes; ed25519Pub: Bytes; amkCheck: Bytes; statement: Statement; device: Parameters<FakeKeysServer["upsertDevice"]>[1]; deviceWrap: Bytes }) => {
          if (self.accounts.some((x) => x.profileId === me)) fail("conflict", "Already set up.");
          const b = body(a.statement);
          if (b.profileId !== me || b.epoch !== 1 || b.x25519Pub !== b64u(a.x25519Pub)) fail("invalid_argument", "statement");
          await signed(a.ed25519Pub, a.statement);
          if (a.device.statement) await signed(a.ed25519Pub, a.device.statement);
          self.accounts.push({ profileId: me, epoch: 1, x25519Pub: a.x25519Pub, ed25519Pub: a.ed25519Pub, amkCheck: a.amkCheck, statement: a.statement, status: "active" });
          self.upsertDevice(me, a.device, "trusted");
          const wrapId = a.device.kind === "session" ? null : self.storeWrap(me, 1, { kind: "device", deviceId: a.device.deviceId, wrapped: a.deviceWrap });
          return { epoch: 1, wrapId };
        }),
        addWrap: m("keys.addWrap", (a: Parameters<FakeKeysServer["storeWrap"]>[2]) => ({ publicId: self.storeWrap(me, requireAccount().epoch, a) })),
        removeWrap: m("keys.removeWrap", (a: { publicId: string }) => {
          const acct = requireAccount();
          const w = self.wraps.find((x) => x.publicId === a.publicId && x.profileId === me);
          if (!w) fail("not_found");
          const before = self.methodKinds(me, acct.epoch);
          const after = self.methodKinds(me, acct.epoch, a.publicId);
          if (after.size < 2 && after.size < before.size && self.grants.some((g) => g.profileId === me)) fail("e2ee_last_method");
          self.wraps = self.wraps.filter((x) => x !== w);
          return null;
        }),
        listWraps: q("keys.listWraps", listWraps),
        getWrap: m("keys.getWrap", (a: { kind: Wrap["kind"]; credentialId?: string }) => {
          const acct = requireAccount();
          const n = (self.unlockAttempts.get(me) ?? 0) + 1;
          if (n > 10) fail("e2ee_rate_limited");
          self.unlockAttempts.set(me, n);
          const w = self.wraps.filter((x) => x.profileId === me && x.epoch === acct.epoch && x.kind === a.kind && (a.kind !== "passkey" || !a.credentialId || x.credentialId === a.credentialId)).sort((x, y) => y.createdAt - x.createdAt)[0];
          if (!w) return null;
          w.lastUsedAt = self.now;
          return { publicId: w.publicId, epoch: w.epoch, kind: w.kind, wrapped: w.wrapped, kdf: w.kdf ?? null, prfSalt: w.prfSalt ?? null, credentialId: w.credentialId ?? null };
        }),
        getDeviceWrap: q("keys.getDeviceWrap", (a: { deviceId: string }) => {
          const acct = self.active(me);
          if (!acct) return null;
          const d = self.devices.find((x) => x.profileId === me && x.deviceId === a.deviceId);
          if (!d || d.status !== "trusted") return null;
          const w = self.wraps.find((x) => x.profileId === me && x.deviceId === a.deviceId && x.epoch === acct.epoch);
          return w ? { publicId: w.publicId, epoch: w.epoch, wrapped: w.wrapped } : null;
        }),
        rotateAccount: m("keys.rotateAccount", async (a: { newEpoch: { epoch: number; x25519Pub: Bytes; ed25519Pub: Bytes; amkCheck: Bytes; statement: Statement }; wraps: Parameters<FakeKeysServer["storeWrap"]>[2][]; regrants: { scope: Scope; grant: Grant }[]; deviceStatements?: { deviceId: string; statement: Statement }[] }) => {
          const cur = requireAccount();
          if (a.newEpoch.epoch !== cur.epoch + 1) fail("conflict");
          cur.status = "superseded";
          self.accounts.push({ profileId: me, ...a.newEpoch, status: "active" });
          for (const w of a.wraps) self.storeWrap(me, a.newEpoch.epoch, w);
          if (self.methodKinds(me, a.newEpoch.epoch).size < 2 && self.grants.some((g) => g.profileId === me)) {
            // Undo, as the real mutation would roll back.
            self.accounts.pop();
            cur.status = "active";
            self.wraps = self.wraps.filter((w) => w.epoch !== a.newEpoch.epoch || w.profileId !== me);
            fail("e2ee_recovery_required");
          }
          for (const { scope, grant } of a.regrants) await self.storeGrants(self.scopeKeyOf(scope, me), me, [grant]);
          for (const { deviceId, statement } of a.deviceStatements ?? []) {
            await signed(a.newEpoch.ed25519Pub, statement);
            const d = self.devices.find((x) => x.profileId === me && x.deviceId === deviceId);
            if (d) d.statement = statement;
          }
          return { epoch: a.newEpoch.epoch };
        }),
        resetAccount: m("keys.resetAccount", (a: { newEpoch: { epoch: number; x25519Pub: Bytes; ed25519Pub: Bytes; amkCheck: Bytes; statement: Statement }; wraps: Parameters<FakeKeysServer["storeWrap"]>[2][] }) => {
          const cur = requireAccount();
          if (a.newEpoch.epoch !== cur.epoch + 1) fail("conflict");
          cur.status = "superseded";
          self.accounts.push({ profileId: me, ...a.newEpoch, status: "active" });
          for (const w of a.wraps) self.storeWrap(me, a.newEpoch.epoch, w);
          let pending = 0;
          for (const [ws, members] of self.workspaces) {
            if (members.some((x) => x.profileId === me) && (self.spaces.get(`workspace:${ws}`)?.currentKeyVersion ?? 0) > 0) {
              self.pending.push({ scopeKey: `workspace:${ws}`, profileId: me, reason: "reset", createdAt: self.now });
              pending++;
            }
          }
          return { epoch: a.newEpoch.epoch, pending };
        }),
        accountKeysOf: q("keys.accountKeysOf", (a: { profileIds: string[] }) =>
          a.profileIds.flatMap((id) => {
            const acct = self.active(id);
            return acct ? [{ profileId: id, epoch: acct.epoch, x25519Pub: acct.x25519Pub, ed25519Pub: acct.ed25519Pub, statement: acct.statement }] : [];
          }),
        ),
      },
      devices: {
        register: m("devices.register", async (a: { device: Parameters<FakeKeysServer["upsertDevice"]>[1] }) => {
          const acct = requireAccount();
          const existing = self.devices.find((x) => x.profileId === me && x.deviceId === a.device.deviceId);
          if (existing?.status === "trusted") {
            if (b64u(existing.x25519Pub) !== b64u(a.device.x25519Pub)) fail("conflict", "This device already has keys.");
            self.upsertDevice(me, { ...a.device, statement: existing.statement }, "trusted");
            return { status: "trusted" as const };
          }
          let st: Device["status"] = "pending";
          if (a.device.statement) {
            const b = body(a.device.statement);
            if (b.approvedBy !== "recovery" || b.deviceId !== a.device.deviceId) fail("invalid_argument", "statement");
            await signed(acct.ed25519Pub, a.device.statement);
            st = "trusted";
          }
          self.upsertDevice(me, a.device, st);
          return { status: st };
        }),
        requestApproval: m("devices.requestApproval", (a: { deviceId: string; kind: Device["kind"]; label: string; platform?: string; x25519Pub: Bytes; ed25519Pub: Bytes; commit: Bytes }) => {
          requireAccount();
          const cancelled = self.approvals.filter((x) => x.profileId === me && x.status === "cancelled").length;
          if (cancelled >= 3) fail("e2ee_rate_limited");
          const existing = self.devices.find((x) => x.profileId === me && x.deviceId === a.deviceId);
          if (existing?.status === "trusted") fail("conflict", "This device is already trusted.");
          self.upsertDevice(me, { deviceId: a.deviceId, kind: a.kind, label: a.label, platform: a.platform ?? "web", x25519Pub: a.x25519Pub, ed25519Pub: a.ed25519Pub }, "pending");
          const requestId = fakeUlid();
          self.approvals.push({ publicId: requestId, profileId: me, deviceId: a.deviceId, commit: a.commit, status: "waiting", createdAt: self.now, expiresAt: self.now + 600_000 });
          return { requestId, expiresAt: self.now + 600_000 };
        }),
        answerApproval: m("devices.answerApproval", (a: { requestId: string; nonce: Bytes; approverDeviceId: string }) => {
          const ap = self.openApproval(me, a.requestId);
          if (ap.status !== "waiting") fail("conflict");
          const d = self.devices.find((x) => x.profileId === me && x.deviceId === a.approverDeviceId);
          if (!d || d.status !== "trusted" || d.kind === "session") fail("forbidden", "Only a trusted device or browser can approve.");
          Object.assign(ap, { status: "answered", approverDeviceId: a.approverDeviceId, approverNonce: a.nonce });
          return null;
        }),
        revealApproval: m("devices.revealApproval", (a: { requestId: string; nonce: Bytes }) => {
          const ap = self.openApproval(me, a.requestId);
          if (ap.status !== "answered") fail("conflict");
          Object.assign(ap, { status: "revealed", requesterNonce: a.nonce });
          return null;
        }),
        completeApproval: m("devices.completeApproval", async (a: { requestId: string; wrapped: Bytes; statement: Statement }) => {
          const acct = requireAccount();
          const ap = self.openApproval(me, a.requestId);
          if (ap.status !== "revealed") fail("conflict");
          const d = self.devices.find((x) => x.profileId === me && x.deviceId === ap.deviceId)!;
          const b = body(a.statement);
          if (b.deviceId !== d.deviceId || b.approvedBy !== ap.approverDeviceId || b.x25519Pub !== b64u(d.x25519Pub)) fail("invalid_argument", "statement");
          await signed(acct.ed25519Pub, a.statement);
          if (d.kind !== "session") {
            self.wraps = self.wraps.filter((w) => !(w.profileId === me && w.kind === "device" && w.deviceId === d.deviceId));
            self.wraps.push({ publicId: fakeUlid(), profileId: me, epoch: acct.epoch, kind: "device", deviceId: d.deviceId, wrapped: a.wrapped, createdAt: self.now });
          }
          Object.assign(d, { status: "trusted", statement: a.statement });
          Object.assign(ap, { status: "done", wrapped: a.wrapped });
          return null;
        }),
        cancelApproval: m("devices.cancelApproval", (a: { requestId: string }) => {
          const ap = self.approvals.find((x) => x.publicId === a.requestId && x.profileId === me);
          if (!ap) fail("not_found");
          if (["waiting", "answered", "revealed"].includes(ap!.status)) ap!.status = "cancelled";
          return null;
        }),
        approval: q("devices.approval", (a: { requestId: string }) => self.approvalRow(me, a.requestId)),
        list: q("devices.list", () =>
          self.devices
            .filter((d) => d.profileId === me)
            .map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label, platform: d.platform, status: d.status, x25519Pub: d.x25519Pub, ed25519Pub: d.ed25519Pub, statement: d.statement ?? null, hasWrap: self.wraps.some((w) => w.deviceId === d.deviceId), createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, revokedAt: null })),
        ),
        touch: m("devices.touch", () => null),
      },
      spaces: {
        get: q("spaces.get", (a: { scope: Scope }) => {
          const key = self.scopeKeyOf(a.scope, me);
          const s = self.spaces.get(key);
          const inboxPub = s ? (self.spaceKeys.find((k) => k.scopeKey === key && k.version === s.currentKeyVersion)?.inboxPub ?? null) : null;
          return { scopeId: key, setUp: !!s && s.currentKeyVersion > 0, level: s?.level ?? "standard", state: s?.state ?? "off", switches: SWITCHES, currentKeyVersion: s?.currentKeyVersion ?? 0, inboxPub, lockedCount: s?.lockedCount ?? 0, active: !!s && (s.level !== "standard" || s.lockedCount > 0), migration: null, keyHolders: 0 };
        }),
        mine: q("spaces.mine", () => {
          const acct = self.active(me);
          const keys = [`personal:${me}`, ...[...self.workspaces].filter(([, ms]) => ms.some((x) => x.profileId === me)).map(([ws]) => `workspace:${ws}`)];
          return keys.flatMap((key) => {
            const s = self.spaces.get(key);
            // The fake lists every space with a key (the real one lists e2ee-active ones; tests encrypt them).
            if (!s || s.currentKeyVersion < 1) return [];
            const scope: Scope = key.startsWith("personal:") ? { kind: "personal" } : { kind: "workspace", workspaceId: key.slice(10) };
            return [
              {
                scope,
                scopeId: key,
                level: s.level,
                state: s.state,
                switches: SWITCHES,
                currentKeyVersion: s.currentKeyVersion,
                lockedCount: s.lockedCount,
                seq: s.seq,
                grants: self.grants
                  .filter((g) => g.scopeKey === key && g.profileId === me && (!acct || g.epoch === acct.epoch))
                  .sort((x, y) => x.version - y.version)
                  .map((g) => ({ version: g.version, epoch: g.epoch, wrapped: g.wrapped, statement: g.statement, grantedBy: g.grantedBy })),
              },
            ];
          });
        }),
        setUp: m("spaces.setUp", async (a: { scope: Scope; key: { version: number; inboxPub: Bytes; skCheck: Bytes }; grants: Grant[] }) => {
          const key = self.scopeKeyOf(a.scope, me);
          self.requireManager(key, me);
          if ((self.spaces.get(key)?.currentKeyVersion ?? 0) > 0) fail("conflict", "This space already has a key.");
          if (!a.grants.some((g) => g.profileId === me && g.version === 1)) fail("invalid_argument", "Grant the key to yourself too.");
          self.spaceKeys.push({ scopeKey: key, ...a.key });
          self.spaces.set(key, { scopeKey: key, level: "selected", state: "on", currentKeyVersion: 1, lockedCount: 0, seq: ++self.seq });
          await self.storeGrants(key, me, a.grants);
          let pending = 0;
          for (const mm of self.members(key)) {
            if (a.grants.some((g) => g.profileId === mm.profileId)) continue;
            self.pending.push({ scopeKey: key, profileId: mm.profileId, reason: "joined", createdAt: self.now });
            pending++;
          }
          return { version: 1, pending };
        }),
        rotate: m("spaces.rotate", async (a: { scope: Scope; key: { version: number; inboxPub: Bytes; skCheck: Bytes }; grants: Grant[]; noteKeys: { documentId: string; version: number; wrappedBy: "space"; spaceVersion: number; wrapped: Bytes }[] }) => {
          const key = self.scopeKeyOf(a.scope, me);
          self.requireManager(key, me);
          const s = self.spaces.get(key) ?? fail("e2ee_not_set_up");
          const version = s!.currentKeyVersion + 1;
          if (a.key.version !== version) fail("conflict");
          for (const k of self.spaceKeys) if (k.scopeKey === key && k.retiredAt === undefined) k.retiredAt = self.now;
          self.spaceKeys.push({ scopeKey: key, ...a.key });
          s!.currentKeyVersion = version;
          await self.storeGrants(key, me, a.grants.filter((g) => g.version === version));
          for (const nk of a.noteKeys) self.noteKeys.push({ ...nk, scopeKey: key, createdBy: me, seq: ++self.seq });
          return { version, pending: 0, noteKeys: a.noteKeys.length, migrationId: "m1" };
        }),
        addNoteKeyWraps: m("spaces.addNoteKeyWraps", (a: { scope: Scope; noteKeys: { documentId: string; version: number; wrappedBy: "space"; spaceVersion: number; wrapped: Bytes }[] }) => {
          const key = self.scopeKeyOf(a.scope, me);
          for (const nk of a.noteKeys) self.noteKeys.push({ ...nk, scopeKey: key, createdBy: me, seq: ++self.seq });
          return { stored: a.noteKeys.length };
        }),
        keyHolders: q("spaces.keyHolders", (a: { scope: Scope }) => {
          const key = self.scopeKeyOf(a.scope, me);
          const v = self.spaces.get(key)?.currentKeyVersion ?? 0;
          const holders = self.members(key).flatMap((mm) => {
            const acct = self.active(mm.profileId);
            const gs = acct ? self.grants.filter((g) => g.scopeKey === key && g.profileId === mm.profileId && g.epoch === acct.epoch) : [];
            return gs.some((g) => g.version === v) ? [{ profileId: mm.profileId, displayName: "", manager: mm.manager, versions: gs.map((g) => g.version) }] : [];
          });
          const pending = self.pending.filter((p) => p.scopeKey === key).map((p) => ({ profileId: p.profileId, displayName: "", reason: p.reason, documentId: p.documentId ?? null, hasKeys: !!self.active(p.profileId), createdAt: p.createdAt }));
          return { currentKeyVersion: v, count: holders.length, holders, pending };
        }),
      },
      grants: {
        grantSpace: m("grants.grantSpace", async (a: { scope: Scope; grants: Grant[] }) => {
          const key = self.scopeKeyOf(a.scope, me);
          self.requireManager(key, me);
          await self.storeGrants(key, me, a.grants);
          return { granted: new Set(a.grants.map((g) => g.profileId)).size };
        }),
        pending: q("grants.pending", (a: { scope: Scope }) => {
          const key = self.scopeKeyOf(a.scope, me);
          self.requireManager(key, me);
          return self.pending
            .filter((p) => p.scopeKey === key)
            .map((p) => ({ profileId: p.profileId, displayName: "", reason: p.reason, documentId: p.documentId ?? null, hasKeys: !!self.active(p.profileId), epoch: self.active(p.profileId)?.epoch ?? null, createdAt: p.createdAt }));
        }),
        grantNote: m("grants.grantNote", async (a: { documentId: string; version: number; profileId: string; wrapped: Bytes; statement: Statement }) => {
          await signed((self.active(me) ?? fail("conflict")).ed25519Pub, a.statement);
          const acct = self.active(a.profileId) ?? fail("conflict", "They haven't set up encryption yet.");
          const b = body(a.statement);
          if (b.documentId !== a.documentId || b.version !== a.version || b.profileId !== a.profileId || b.granteeX25519Pub !== b64u(acct!.x25519Pub) || b.grantedBy !== me) fail("invalid_argument", "statement");
          const scopeKey = self.noteKeys.find((n) => n.documentId === a.documentId)?.scopeKey ?? "";
          self.noteKeys = self.noteKeys.filter((n) => !(n.documentId === a.documentId && n.wrappedBy === "grant" && n.profileId === a.profileId && n.version === a.version));
          self.noteKeys.push({ documentId: a.documentId, scopeKey, version: a.version, wrappedBy: "grant", profileId: a.profileId, wrapped: a.wrapped, statement: a.statement, createdBy: me, seq: ++self.seq });
          self.pending = self.pending.filter((p) => !(p.documentId === a.documentId && p.profileId === a.profileId && p.reason === "page"));
          return null;
        }),
        noteAudience: q("grants.noteAudience", () => []),
        myNoteKeys: q("grants.myNoteKeys", (a: { documentIds: string[] }) =>
          self.noteKeys
            .filter((n) => a.documentIds.includes(n.documentId) && ((n.wrappedBy === "grant" && n.profileId === me) || (n.wrappedBy === "space" && self.grants.some((g) => g.scopeKey === n.scopeKey && g.profileId === me))))
            .map((n) => ({ documentId: n.documentId, version: n.version, wrappedBy: n.wrappedBy, spaceVersion: n.spaceVersion ?? null, wrapped: n.wrapped, statement: n.statement ?? null, grantedBy: n.createdBy })),
        ),
      },
      pullNoteKeys: q("pull", (a: { scope: Scope; cursor: number }) => {
        const key = self.scopeKeyOf(a.scope, me);
        const rows = self.noteKeys.filter((n) => n.scopeKey === key && n.seq > a.cursor && n.wrappedBy === "space");
        return { noteKeys: rows.map((n) => ({ documentId: n.documentId, version: n.version, wrappedBy: n.wrappedBy, spaceVersion: n.spaceVersion ?? null, wrapped: n.wrapped })), nextCursor: Math.max(a.cursor, ...rows.map((r) => r.seq)), hasMore: false };
      }),
      watchApprovals: (cb: (rows: unknown[]) => void) => watch("approvals", () => (self.tamperApprovals ? self.tamperApprovals(self.approvalRows(me)) : self.approvalRows(me)), cb),
      watchApproval: (requestId: string, cb: (row: unknown) => void) =>
        watch("approval", () => {
          const r = self.approvalRow(me, requestId);
          return r && self.tamperApproval ? self.tamperApproval(r) : r;
        }, cb),
      watchWraps: (cb: (rows: unknown[]) => void) => watch("wraps", listWraps, cb),
      watchStatus: (cb: (s: unknown) => void) => watch("status", status, cb),
    };
    return server as unknown as KeysServer;
  }

  /** A document's note key as the replica would upload it (WP3's document.create): stored as a space wrap. */
  addNoteKeyRow(row: { documentId: string; scope: Scope; owner: string; version: number; spaceVersion: number; wrapped: Uint8Array }) {
    this.noteKeys.push({ documentId: row.documentId, scopeKey: this.scopeKeyOf(row.scope, row.owner), version: row.version, wrappedBy: "space", spaceVersion: row.spaceVersion, wrapped: row.wrapped.slice().buffer, createdBy: row.owner, seq: ++this.seq });
  }

  /** Settings > Devices > Remove (WP2's devices.revoke): its wraps go, it's marked revoked. */
  revoke(profileId: string, deviceId: string) {
    this.wraps = this.wraps.filter((w) => !(w.profileId === profileId && w.deviceId === deviceId));
    const d = this.devices.find((x) => x.profileId === profileId && x.deviceId === deviceId);
    if (d) Object.assign(d, { status: "revoked", statement: undefined });
    this.notify();
  }
}
