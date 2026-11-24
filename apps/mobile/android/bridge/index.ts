// The bridge's TypeScript half (scripts/bundle-bridge.mjs builds it into assets/folevi-cloud.js): what
// folevi-bridge.js needs from the shared packages. Handed to the bridge as its second argument.
export { createCloudKit, copyLibrary, prepareLibrary, isCloudKind, KIND_PROVIDER, LIBRARY_FILE } from "./cloud";
