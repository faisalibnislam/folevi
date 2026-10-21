// Short authentication strings (docs/E2EE_DESIGN.md §4.8, §8.6): the device approval commitment and code, and
// the member security code.
import { E2eeError, constantTimeEqual, isBytes, sha256Concat } from "./primitives";

function need(bytes: Uint8Array, length: number, what: string): void {
  if (!isBytes(bytes) || bytes.length !== length) throw new E2eeError(`${what} must be ${length} bytes.`);
}

/** commit = SHA-256("folevi/e2ee/v1/approval-commit" ‖ n_N ‖ K_N.x ‖ K_N.ed) */
export async function approvalCommit(nonce: Uint8Array, x25519Pub: Uint8Array, ed25519Pub: Uint8Array): Promise<Uint8Array> {
  need(nonce, 32, "The approval nonce");
  need(x25519Pub, 32, "The X25519 public key");
  need(ed25519Pub, 32, "The Ed25519 public key");
  return sha256Concat("folevi/e2ee/v1/approval-commit", nonce, x25519Pub, ed25519Pub);
}

/** Constant-time check of a revealed nonce against the commitment made in step 1. */
export async function checkApprovalCommit(
  commit: Uint8Array,
  nonce: Uint8Array,
  x25519Pub: Uint8Array,
  ed25519Pub: Uint8Array,
): Promise<boolean> {
  return constantTimeEqual(commit, await approvalCommit(nonce, x25519Pub, ed25519Pub));
}

export interface ApprovalCodeInput {
  newX: Uint8Array;
  newEd: Uint8Array;
  approverEd: Uint8Array;
  accountX: Uint8Array;
  accountEd: Uint8Array;
  approverNonce: Uint8Array;
  newNonce: Uint8Array;
}

/**
 * The 6-digit code both devices show: the first 20 bits of SHA-256("folevi/e2ee/v1/approval-code" ‖ K_N.x ‖
 * K_N.ed ‖ K_T.ed ‖ A.x ‖ A.ed ‖ n_T ‖ n_N) as a decimal number mod 10^6, zero-padded ("482019"; shown "482 019").
 */
export async function approvalCode(i: ApprovalCodeInput): Promise<string> {
  for (const [k, v] of Object.entries(i)) need(v as Uint8Array, 32, k);
  const h = sha256Concat(
    "folevi/e2ee/v1/approval-code",
    i.newX,
    i.newEd,
    i.approverEd,
    i.accountX,
    i.accountEd,
    i.approverNonce,
    i.newNonce,
  );
  const bits20 = (h[0]! << 12) | (h[1]! << 4) | (h[2]! >> 4);
  return String(bits20 % 1_000_000).padStart(6, "0");
}

/**
 * A member's 12-digit security code: the first 40 bits of SHA-256("folevi/e2ee/v1/member-code" ‖ ed25519Pub)
 * as a decimal number mod 10^12, zero-padded ("012345678901"; shown in four groups of three).
 */
export async function memberSecurityCode(ed25519Pub: Uint8Array): Promise<string> {
  need(ed25519Pub, 32, "The Ed25519 public key");
  const h = sha256Concat("folevi/e2ee/v1/member-code", ed25519Pub);
  let n = 0;
  for (let k = 0; k < 5; k++) n = n * 256 + h[k]!;
  return String(n % 1_000_000_000_000).padStart(12, "0");
}

/** "482019" → "482 019"; "012345678901" → "012 345 678 901". */
export function formatCode(code: string): string {
  return code.replace(/(\d{3})(?=\d)/g, "$1 ");
}
