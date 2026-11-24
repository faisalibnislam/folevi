// The page's calls for the Dropbox and Google Drive connections (preload.ts `foleviShell.library.cloud`):
// which are offered, the status, connect (or reconnect), cancel and sign out. Only the status crosses to the
// page; tokens never do. Same rules as ../ipc.ts: only the bundled interface's own pages, every argument
// checked, answers as { ok, value } / { ok: false, error } envelopes. Status changes go to every page that
// asked, as "cloud:status".
import type { CloudConnections, ConnectionStatus } from "./shared/connection";
import { isCloudError, type CloudProvider } from "./shared/types";

export const CLOUD_CHANNELS = ["status", "connect", "cancel", "sign-out", "subscribe"] as const;
export const CLOUD_STATUS_CHANNEL = "cloud:status";

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

export interface CloudIpcSender {
  id: number;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): unknown;
}
export interface CloudIpcEvent {
  sender: CloudIpcSender;
  senderFrame?: { url: string } | null;
}
export interface CloudIpcMain {
  handle(channel: string, listener: (e: CloudIpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

function providerOf(v: unknown): CloudProvider {
  if (v !== "dropbox" && v !== "googleDrive") throw Object.assign(new Error("The provider is dropbox or googleDrive."), { code: "invalid_argument" });
  return v;
}

function codeOf(error: unknown): string {
  if (isCloudError(error)) return error.kind;
  const name = (error as { name?: string })?.name;
  if (name === "SignInCancelled") return "cancelled";
  if (name === "OneConnectionOnly") return "one_connection";
  if (name === "TokenStorageUnavailable") return "keychain_unavailable";
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : "io";
}

export function registerCloudIpc(ipc: CloudIpcMain, connections: CloudConnections, allowed: (e: CloudIpcEvent) => boolean): () => void {
  const subscribers = new Map<number, CloudIpcSender>();
  const off = connections.onStatus((s: ConnectionStatus) => {
    for (const [id, sender] of subscribers) {
      if (sender.isDestroyed()) subscribers.delete(id);
      else sender.send(CLOUD_STATUS_CHANNEL, s);
    }
  });

  const handle = (name: (typeof CLOUD_CHANNELS)[number], work: (e: CloudIpcEvent, ...args: unknown[]) => unknown) => {
    ipc.handle(`cloud:${name}`, async (e, ...args): Promise<Envelope<unknown>> => {
      if (!allowed(e)) return { ok: false, error: { code: "invalid_argument", message: "Not from Folevi." } };
      try {
        return { ok: true, value: (await work(e, ...args)) ?? null };
      } catch (error) {
        return { ok: false, error: { code: codeOf(error), message: error instanceof Error ? error.message : String(error) } };
      }
    });
  };

  handle("status", () => connections.status());
  handle("connect", (_e, provider) => connections.connect(providerOf(provider)));
  handle("cancel", () => {
    connections.cancelConnect();
    return true;
  });
  handle("sign-out", () => connections.signOut());
  handle("subscribe", (e) => {
    const sender = e.sender;
    if (!subscribers.has(sender.id)) {
      subscribers.set(sender.id, sender);
      sender.once("destroyed", () => subscribers.delete(sender.id));
    }
    return connections.status();
  });

  return () => {
    off();
    for (const name of CLOUD_CHANNELS) ipc.removeHandler(`cloud:${name}`);
    subscribers.clear();
  };
}
