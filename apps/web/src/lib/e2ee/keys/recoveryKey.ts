// The recovery key (docs/E2EE_DESIGN.md §4.7.1): 20 random bytes shown once as 36 characters in 9 groups.
// It counts only after the person types groups 3 and 7 back. Its wrap of the account master key is an
// FLV1 0x03 record under HKDF(bytes, "recovery/wrap"), keyVersion = the account epoch.
import { constantTimeEqualString, newRecoveryKey, openRecord, parseRecoveryKey, recoveryKeyGroup, recoveryWrapKey, sealRecord } from "@folevi/local-store/e2ee";

/** Which groups the wizard asks back (1-based). */
export const CONFIRM_GROUPS = [3, 7] as const;

export { newRecoveryKey, parseRecoveryKey };

/** Whether the two typed groups are groups 3 and 7 of the key (case, spaces and O/I/L as the parser reads them). */
export function groupsMatch(text: string, typed: [string, string]): boolean {
  const clean = (g: string) =>
    g
      .toUpperCase()
      .replace(/[\s-]/g, "")
      .replace(/O/g, "0")
      .replace(/[IL]/g, "1");
  const want = CONFIRM_GROUPS.map((n) => recoveryKeyGroup(text, n));
  // Both groups are always compared (each in constant time), so the answer doesn't say which one was wrong.
  const a = constantTimeEqualString(clean(typed[0] ?? ""), want[0]!);
  const b = constantTimeEqualString(clean(typed[1] ?? ""), want[1]!);
  return a && b;
}

export async function wrapWithRecoveryKey(keyBytes: Uint8Array, epoch: number, context: string, amk: Uint8Array): Promise<Uint8Array> {
  return sealRecord(await recoveryWrapKey(new Uint8Array(keyBytes)), epoch, context, amk);
}

/** The AMK, or null when this recovery key doesn't open the wrap. Zeroes `keyBytes`. */
export async function openWithRecoveryKey(keyBytes: Uint8Array, context: string, wrapped: Uint8Array): Promise<Uint8Array | null> {
  try {
    const key = await recoveryWrapKey(keyBytes);
    return await openRecord(key, context, wrapped);
  } catch {
    return null;
  } finally {
    keyBytes.fill(0);
  }
}
