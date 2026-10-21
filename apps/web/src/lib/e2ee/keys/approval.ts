// Approving a new device from a trusted one (docs/E2EE_DESIGN.md §4.8): commit, then reveal, then a short code
// both people compare. The new device commits to its nonce and keys before it sees the trusted device's
// nonce, so a server substituting keys can't grind a matching code. The code binds both devices' keys, the
// account's public keys and both nonces; only after "They match" does the trusted device seal the account
// master key to the new device's key and sign its device statement.
import {
  approvalCode,
  approvalCommit,
  checkApprovalCommit,
  ctx,
  randomBytes,
  sealTo,
  signStatement,
  toBase64Url,
} from "@folevi/local-store/e2ee";
import type { ApprovalHandle, IncomingApproval, KeySessionImpl } from "./session";
import type { ApprovalListRow, ApprovalRow } from "./server";
import { KeysError, bytes, errorCode, wire } from "./util";

/** The new device: asks, shows the code once the other device answered, and opens the key when it's sent. */
export async function newDeviceApproval(s: KeySessionImpl): Promise<ApprovalHandle> {
  const b = s.bound();
  const status = s.accountStatus() ?? (await s.refreshStatus());
  if (!status?.setUp || !status.x25519Pub || !status.ed25519Pub) throw new KeysError("e2ee_not_set_up", "Set up encryption first.");
  const accountX = bytes(status.x25519Pub);
  const accountEd = bytes(status.ed25519Pub);
  const epoch = status.epoch;
  let dev = await s.deviceToTrust();
  const nonce = randomBytes(32);
  const ask = async () =>
    b.server.devices.requestApproval({
      deviceId: dev.deviceId,
      kind: dev.kind,
      label: s.label(dev.kind),
      platform: s.platform(),
      x25519Pub: wire(dev.x25519Pub),
      ed25519Pub: wire(dev.ed25519Pub),
      commit: wire(await approvalCommit(nonce, dev.x25519Pub, dev.ed25519Pub)),
    });
  let requestId: string;
  try {
    requestId = (await ask()).requestId;
  } catch (e) {
    // A device id removed from the account before: start again with new keys and a new id.
    if (errorCode(e) !== "forbidden") throw e;
    await s.mac()?.reset();
    dev = await s.deviceToTrust(true);
    requestId = (await ask()).requestId;
  }

  let settled = false;
  let revealed = false;
  let opening = false;
  let resolveCode!: (c: string) => void;
  let rejectCode!: (e: unknown) => void;
  let resolveDone!: (ok: boolean) => void;
  const code = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  const done = new Promise<boolean>((res) => {
    resolveDone = res;
  });
  // Nobody may be listening to `code` (the dialog closed): its rejection mustn't surface as unhandled.
  code.catch(() => undefined);
  let off: (() => void) | null = null;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    nonce.fill(0);
    off?.();
    off = null;
    if (!ok) rejectCode(new KeysError("e2ee_approval_ended", "The request ended."));
    resolveDone(ok);
  };
  let chain = Promise.resolve();
  const onRow = (row: ApprovalRow | null) => {
    chain = chain.then(async () => {
      if (settled || !row) return;
      if (row.status === "cancelled" || row.status === "expired") return finish(false);
      if (row.status === "answered" && !revealed && row.approverNonce && row.approverEd25519Pub) {
        revealed = true;
        try {
          const c = await approvalCode({
            newX: dev.x25519Pub,
            newEd: dev.ed25519Pub,
            approverEd: bytes(row.approverEd25519Pub),
            accountX,
            accountEd,
            approverNonce: bytes(row.approverNonce),
            newNonce: nonce,
          });
          await b.server.devices.revealApproval({ requestId, nonce: wire(nonce) });
          resolveCode(c);
        } catch {
          finish(false);
        }
        return;
      }
      if (row.status === "done" && row.wrapped && !opening) {
        opening = true;
        const wrapped = bytes(row.wrapped);
        try {
          const amk = await dev.open(wrapped, ctx.amkDevice(b.profileId, dev.deviceId));
          // finishApproved checks the AMK against the account's public keys (A) before keeping it.
          finish(await s.finishApproved(dev, amk, epoch, wrapped));
        } catch {
          finish(false);
        }
      }
    });
  };
  off = b.server.watchApproval(requestId, onRow);
  return {
    code,
    done,
    cancel: () => {
      if (settled) return;
      void b.server.devices.cancelApproval({ requestId }).catch(() => undefined);
      finish(false);
    },
  };
}

/** On a trusted device: the waiting requests as IncomingApprovals (kept per request, so a dialog's object stays the same). */
export function incomingApprovals(s: KeySessionImpl): (rows: ApprovalListRow[]) => IncomingApproval[] {
  const cache = new Map<string, { item: IncomingApproval; update(row: ApprovalListRow | null): void }>();
  return (rows) => {
    const me = s.deviceId();
    const visible = rows.filter((r) => r.deviceId !== me && (r.status === "waiting" || r.approverDeviceId === me));
    const seen = new Set<string>();
    for (const row of visible) {
      seen.add(row.requestId);
      const hit = cache.get(row.requestId);
      if (hit) hit.update(row);
      else cache.set(row.requestId, incoming(s, row));
    }
    for (const [id, hit] of cache) {
      if (!seen.has(id)) {
        hit.update(null);
        cache.delete(id);
      }
    }
    return visible.map((r) => cache.get(r.requestId)!.item);
  };
}

function incoming(s: KeySessionImpl, first: ApprovalListRow): { item: IncomingApproval; update(row: ApprovalListRow | null): void } {
  let row: ApprovalListRow | null = first;
  let nonce: Uint8Array | null = null;
  let started: Promise<string> | null = null;
  let revealedRow: ApprovalListRow | null = null;
  const waiters = new Set<() => void>();
  const update = (next: ApprovalListRow | null) => {
    row = next;
    for (const w of [...waiters]) w();
  };
  /** Resolves with the row once the new device revealed its nonce; rejects if the request ends first. */
  const whenRevealed = () =>
    new Promise<ApprovalListRow>((resolve, reject) => {
      const check = () => {
        if (!row) {
          waiters.delete(check);
          reject(new KeysError("e2ee_approval_ended", "The request ended."));
        } else if (row.status === "revealed" && row.requesterNonce) {
          waiters.delete(check);
          resolve(row);
        }
      };
      waiters.add(check);
      check();
    });

  const item: IncomingApproval = {
    requestId: first.requestId,
    label: first.label,
    createdAt: first.createdAt,
    start() {
      started ??= (async () => {
        const u = s.unlocked();
        if (!u.device || u.device.kind === "session") throw new KeysError("forbidden", "Only a trusted device or browser can approve.");
        nonce = randomBytes(32);
        await u.server.devices.answerApproval({ requestId: first.requestId, nonce: wire(nonce), approverDeviceId: u.device.deviceId });
        const r = await whenRevealed();
        const newNonce = bytes(r.requesterNonce!);
        const newX = bytes(r.x25519Pub);
        const newEd = bytes(r.ed25519Pub);
        // The new device must reveal the nonce it committed to before it saw ours.
        if (!(await checkApprovalCommit(bytes(r.commit), newNonce, newX, newEd))) {
          await u.server.devices.cancelApproval({ requestId: first.requestId }).catch(() => undefined);
          throw new KeysError("e2ee_approval_mismatch", "The new device's keys changed during the request.");
        }
        revealedRow = r;
        return approvalCode({
          newX,
          newEd,
          approverEd: u.device.ed25519Pub,
          accountX: u.account.x25519.publicKey,
          accountEd: u.account.ed25519.publicKey,
          approverNonce: nonce,
          newNonce,
        });
      })();
      return started;
    },
    async confirm() {
      await started;
      const r = revealedRow;
      if (!r) throw new KeysError("e2ee_approval_ended", "The request ended.");
      const u = s.unlocked();
      const newX = bytes(r.x25519Pub);
      const wrapped = await u.amk.use((raw) => sealTo(newX, ctx.amkDevice(u.profileId, r.deviceId), raw));
      const statement = await signStatement(u.account.ed25519.privateKey, "device", {
        profileId: u.profileId,
        deviceId: r.deviceId,
        kind: r.kind,
        x25519Pub: toBase64Url(newX),
        ed25519Pub: toBase64Url(bytes(r.ed25519Pub)),
        label: r.label,
        approvedBy: u.device!.deviceId,
        approvedAt: u.now(),
      });
      await u.server.devices.completeApproval({ requestId: r.requestId, wrapped: wire(wrapped), statement });
      nonce?.fill(0);
    },
    async reject() {
      nonce?.fill(0);
      await s.bound().server.devices.cancelApproval({ requestId: first.requestId });
    },
  };
  return { item, update };
}
