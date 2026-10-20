// The Mac's wiring for the built-in Dropbox and Google Drive connections: client ids from the build
// (dist/cloud-config.json) or the environment, tokens in safeStorage, the library's copy on this Mac under
// Application Support, the sign-in in the default browser, requests through Electron's `net.fetch` (the
// system's proxy settings and certificates). Everything runs in the main process; the page only gets the
// connection's status and the library's files (ipc.ts). Electron only.
import { app, ipcMain, net, safeStorage, shell } from "electron";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { readCloudConfig, type CloudClientConfig } from "./config";
import { CloudConnections, type SavedConnection } from "./connection";
import { registerCloudIpc, type CloudIpcEvent } from "./ipc";
import { CloudLibrary } from "./library";
import { DROPBOX_PORTS, startLoopback } from "./loopback";
import { NodeMirror } from "./nodeMirror";
import { SafeStorageTokenStore } from "./tokenStore";
import { PROVIDER_NAMES, type CloudProvider } from "./types";

export function loadCloudConfig(): CloudClientConfig {
  let file: unknown = null;
  try {
    file = JSON.parse(readFileSync(join(app.getAppPath(), "dist", "cloud-config.json"), "utf8"));
  } catch {
    /* No file: a build without ids (or a development run using the environment). */
  }
  return readCloudConfig(process.env, file);
}

/** Where the library's copy for a provider lives on this Mac (kept after signing out). */
export function cloudLibraryFolder(provider: CloudProvider): string {
  return join(app.getPath("userData"), "Cloud libraries", provider === "dropbox" ? "Dropbox" : "Google Drive");
}

function savedConnectionFile() {
  const file = join(app.getPath("userData"), "cloud-connection.json");
  return {
    async load(): Promise<SavedConnection | null> {
      try {
        const v = JSON.parse(readFileSync(file, "utf8")) as Partial<SavedConnection>;
        if ((v.provider === "dropbox" || v.provider === "googleDrive") && typeof v.connectedAt === "number")
          return { provider: v.provider, account: typeof v.account === "string" ? v.account : null, connectedAt: v.connectedAt };
      } catch {
        /* none */
      }
      return null;
    },
    async save(s: SavedConnection | null): Promise<void> {
      if (!s) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

/**
 * Everything main.ts needs, in one call (with the bundled interface): the connections restored from the last
 * run, the library adapter, and the page's cloud:* calls registered for Folevi's own pages.
 */
export function startCloud(allowed: (e: CloudIpcEvent) => boolean): { connections: CloudConnections; library: CloudLibrary; dispose(): void } {
  const connections = createCloudConnections();
  void connections.restore().catch((e) => console.error("Folevi cloud:", e));
  const library = new CloudLibrary(connections);
  const off = registerCloudIpc({ handle: (c, l) => ipcMain.handle(c, l as never), removeHandler: (c) => ipcMain.removeHandler(c) }, connections, allowed);
  return {
    connections,
    library,
    dispose: () => {
      off();
      connections.cancelConnect();
    },
  };
}

export function createCloudConnections(log: (message: string) => void = (m) => console.log(`Folevi cloud: ${m}`)): CloudConnections {
  return new CloudConnections({
    config: loadCloudConfig(),
    fetch: (input, init) => net.fetch(input, init),
    tokens: new SafeStorageTokenStore(join(app.getPath("userData"), "cloud-tokens.bin"), safeStorage),
    saved: savedConnectionFile(),
    mirrorFor: (provider) => new NodeMirror(cloudLibraryFolder(provider)),
    openBrowser: (url) => shell.openExternal(url),
    listen: (provider, state) => startLoopback({ ports: provider === "dropbox" ? DROPBOX_PORTS : [0], state, providerName: PROVIDER_NAMES[provider] }),
    log,
  });
}
