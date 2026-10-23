// What the app's Kotlin side answers the bridge's cloud code with (CloudPlugin.kt, CloudAuth.kt, LibraryPlugin.kt's
// mirror calls), over a fake provider: the same host rules, the token added on the native side (never by the
// bridge), base64 bodies both ways, a refresh after a 401. For bridge/cloud.test.ts.
import type { MemoryMirror } from "../../../packages/cloud-folders/src/mirror";
import type { Bytes, Call } from "./cloud";

export const bytes: Bytes = {
  toBase64: (b) => Buffer.from(b).toString("base64"),
  fromBase64: (s) => new Uint8Array(Buffer.from(s, "base64")),
};

const HOSTS: Record<string, Set<string>> = {
  dropbox: new Set(["api.dropboxapi.com", "content.dropboxapi.com"]),
  dropboxPlain: new Set(["notify.dropboxapi.com"]),
  googleDrive: new Set(["www.googleapis.com"]),
};

export interface FakeNative {
  call: Call;
  /** Requests the bridge asked for, as the app saw them (the Authorization header is never among them). */
  seen: { url: string; headers: Record<string, string>; authorized: boolean }[];
}

export function fakeNative(o: { fetch: typeof fetch; token: () => string; refresh: () => string; mirror: MemoryMirror }): FakeNative {
  const seen: FakeNative["seen"] = [];
  let token = o.token();
  const call: Call = async (plugin, method, args = {}) => {
    if (plugin === "FoleviCloud" && method === "request") {
      const { provider, url, method: m, headers, body, authorized } = args as { provider: string; url: string; method: string; headers: Record<string, string>; body: string | null; authorized: boolean };
      seen.push({ url, headers: { ...headers }, authorized });
      const u = new URL(url);
      const hosts = provider === "dropbox" ? (authorized ? HOSTS.dropbox : HOSTS.dropboxPlain) : HOSTS.googleDrive;
      if (u.protocol !== "https:" || !hosts!.has(u.hostname)) throw Object.assign(new Error("Folevi only talks to the provider from here."), { code: "invalid" });
      for (let attempt = 1; attempt <= 2; attempt++) {
        const h = new Headers(headers);
        h.delete("authorization");
        if (authorized) h.set("authorization", `Bearer ${token}`);
        let res: Response;
        try {
          res = await o.fetch(url, { method: m, headers: h, body: body ? new Uint8Array(Buffer.from(body, "base64")) : undefined });
        } catch {
          throw Object.assign(new Error("Can't reach the provider."), { code: "offline" });
        }
        if (res.status === 401 && authorized && attempt === 1) {
          token = o.refresh();
          continue;
        }
        const out: Record<string, string> = {};
        res.headers.forEach((v, k) => (out[k] = v));
        return { status: res.status, headers: out, body: bytes.toBase64(new Uint8Array(await res.arrayBuffer())) };
      }
    }
    if (plugin === "FoleviCloud" && method === "status") return { available: ["dropbox", "googleDrive"], provider: "dropbox", state: "connected", account: null };
    if (plugin === "FoleviLibrary") {
      const path = args.path as string;
      switch (method) {
        case "mirrorRead": {
          const f = await o.mirror.readFile(path);
          return f ? { data: bytes.toBase64(f.bytes), etag: f.etag } : { missing: true };
        }
        case "mirrorWrite":
          await o.mirror.writeFile(path, bytes.fromBase64(args.data as string), args.etag as string);
          return {};
        case "mirrorDelete":
          await o.mirror.deleteFile(path);
          return {};
        case "mirrorPaths":
          return { paths: await o.mirror.paths() };
        case "mirrorLoadState": {
          const s = await o.mirror.loadState();
          return { state: s === null ? null : JSON.stringify(s) };
        }
        case "mirrorSaveState":
          await o.mirror.saveState(JSON.parse(args.state as string));
          return {};
      }
    }
    throw new Error(`fake native: no ${plugin}.${method}`);
  };
  return { call, seen };
}
