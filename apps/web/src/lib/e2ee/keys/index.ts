// The key side of end-to-end encryption on the device (docs/E2EE_DESIGN.md §12 WP6): the session (lock state,
// unlocking, trusting this browser), the key ring (space and note keys), setup (account, ways to unlock,
// rotation, grants) and the hooks the screens use.
export {
  endKeySession,
  getKeySession,
  keepOnSignOut,
  startKeySession,
  type ApprovalHandle,
  type IncomingApproval,
  type KeySession,
  type KeysBinding,
  type LockState,
  type MethodKind,
  type MethodSummary,
} from "./session";
export { getKeyRing, type KeyRing, type PulledNoteKey } from "./keyring";
export { setup } from "./setup";
export { useApprovals, useKeySession, useRecoveryMethods } from "./useKeys";
export { convexKeysServer, type KeysServer } from "./server";
export { passphraseProblem, MIN_PASSPHRASE, type PassphraseProblem } from "./passphrase";
export { passkeysPossible } from "./passkey";
export { inMacApp, inNativeApp, macE2ee, nativeE2ee, nativeLabel, nativePlatform, nativeProduct, thisDevice, type NativePlatform } from "./macBridge";
