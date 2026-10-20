// Built-in "Sync with Dropbox" and "Sync with Google Drive" for local mode (docs/LOCAL_MODE_PLAN.md WP9b,
// docs/LOCAL_MODE.md "Dropbox and Google Drive").
//
// Platform neutral (fetch, WebCrypto and plain data only; the iPhone and iPad app can reuse them):
//   types.ts       LocalFs shape, CloudError ("offline", "reconnect", "busy", "quota", "protocol")
//   http.ts        retries: 429 / 503 with Retry-After, 5xx backoff, dropped connections, offline
//   oauth.ts       PKCE, Dropbox and Google OAuth clients, TokenManager (refresh, Reconnect), AuthedHttp
//   mirror.ts      the library's copy on the device (interface, in-memory version)
//   cloudFs.ts     index + change feed + read-through copy + watch loop, shared by both providers
//   dropbox.ts     DropboxFs (app folder)
//   drive.ts       DriveFs (drive.file, "Folevi" folder)
//   config.ts      client ids from the build, hidden options without them
//   connection.ts  CloudConnections: sign in, status, sign out, the LocalFs, watching
//   library.ts     CloudLibrary: the library file, info, change batches, copying everything here
//   ipc.ts         the page's cloud:* calls
// Node or Electron only:
//   loopback.ts    the 127.0.0.1 redirect listener
//   nodeMirror.ts  the device copy as a folder in Application Support
//   tokenStore.ts  tokens encrypted with safeStorage
//   electron.ts    createCloudConnections() for main.ts
export { CloudConnections, type ConnectionStatus, type ConnectionState } from "./connection";
export { CloudLibrary } from "./library";
export { registerCloudIpc, CLOUD_STATUS_CHANNEL } from "./ipc";
export { CloudError, isCloudError, PROVIDER_NAMES, type CloudProvider } from "./types";
