// The bridge's TypeScript half for the iPhone and iPad app (scripts/bundle-cloud.mjs builds it into
// ios/App/Native/Shell/folevi-cloud.js, which FoleviViewController puts inside bridge.js): Dropbox and Google
// Drive libraries with the shared provider code (packages/cloud-folders), through the same kit the Android app
// runs (apps/android/bridge/cloud.ts: requests go to the app, which adds the token; the library's copy is the
// app's). The native calls it makes are answered by Native/Shell/FoleviShellPlugin.swift.
export { createCloudKit, copyLibrary, prepareLibrary, isCloudKind, KIND_PROVIDER, LIBRARY_FILE } from "../../android/bridge/cloud";
