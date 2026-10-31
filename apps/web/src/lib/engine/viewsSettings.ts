// Settings on the Mac, native (docs/MAC_REBUILD_PLAN.md section 0, owner decision 2026-10-27: every Settings
// section native, the technical ones too). One view, `settings.query`, and one command, `settings.run`, each with
// a key from a fixed list: what the web's Settings sections read and do, worded here with the same helpers the
// web uses (so the words stay the web's), and the Convex functions the account's sections call, by an allowlist.
// The host's own parts (the library, its lock, Foli AI on the device, the Mac app's settings) come from shell()
// and window.foleviDesktop, as the web's sections read them.
import { api } from "@/lib/convex/api";
import { formatRelative } from "@/lib/format";
import { shell } from "@/lib/shell";
import { deviceWords } from "@/lib/shell/words";
import type { CloudStatus, LibraryInfo, LibraryKind, ShellLockSettings } from "@/lib/shell/types";
import type { LibraryControl, LibraryStatus } from "@/lib/local/store/types";
import { hostError, kindOf, placeName, placeProblem, providerName, providerOf } from "@/lib/local/libraryPlace";
import { KEY_PROVIDERS, PROVIDERS, PROVIDER_ORDER, modelLabel } from "@/lib/local/ai/catalog";
import { localAiHost, localAiState, refreshLocalAi, setLocalAiChoice, subscribeLocalAi, usable, type LocalAiState } from "@/lib/local/ai/state";
import type { AiKeyProvider, AiProviderId } from "@/lib/shell/types";
import { desktop, shortcutLabel, DEFAULT_QUICK_ADD_SHORTCUT, type DesktopSettings } from "@/lib/desktop";
import { MIN_PASSPHRASE, passphraseHere, placeOptions, thisDevice, movePlace } from "@/components/app/LibrarySetup";
import { ON_DEVICE_COPY, cleanKey } from "@/components/views/settings/LocalAiSection";
import type { EngineDeps, ViewContext } from "./context";
import type { ValueViewDef } from "./views";
import type { CommandDef } from "./commands";
import { Emitter, signalOf, type Signal } from "./live";
import { source } from "./views";
import { BridgeError, oneOf, only } from "./validate";
import { importFiles } from "@/lib/import/run";
import { importTakeout } from "@/lib/migrate/takeout";
import { accountUpload, clientTarget, libraryPutFile } from "@/lib/migrate/target";
import type { MigrationClient } from "@/lib/migrate/types";
import { deviceId as loadDeviceId } from "@/lib/sync/db";
import type { WireScope } from "@folevi/editor-schema";
import { SETTINGS_QUERY_KEYS, SETTINGS_RUN_KEYS, type CommandName, type SettingsQueryKey, type SettingsRunKey, type ViewName } from "./protocol";

type Args = Record<string, unknown>;
const obj = (v: unknown): Args => (v && typeof v === "object" && !Array.isArray(v) ? (v as Args) : {});
const str = (a: Args, k: string): string => {
  const v = a[k];
  if (typeof v !== "string") throw new BridgeError("invalid_args", `${k} must be text.`);
  return v;
};

// ---- the library (local mode) ------------------------------------------------------------------------------

function control(deps: EngineDeps): LibraryControl | null {
  return (deps.client as unknown as { local?: { library?: LibraryControl } }).local?.library ?? null;
}

function syncLine(status: LibraryStatus | null): string {
  if (!status) return "";
  if (status.state === "unavailable") return `Folevi can't reach the library right now. Your edits are kept on ${thisDevice()} until it's back.`;
  if (status.state === "locked") return "Locked: enter the passphrase to sync.";
  if (status.syncing) return "Syncing…";
  if (status.unsaved > 0) return `${status.unsaved} ${status.unsaved === 1 ? "change" : "changes"} not in the library yet`;
  if (status.lastSyncAt) return `Synced ${formatRelative(status.lastSyncAt)}`;
  return "Not synced yet";
}

/** The status, short enough for a row's value on the iPhone (LibrarySection.tsx shortStatus). */
function shortStatus(status: LibraryStatus | null): string {
  if (!status) return "…";
  if (status.state === "unavailable") return "Can't reach it";
  if (status.state === "locked") return "Locked";
  if (status.syncing) return "Syncing…";
  if (status.unsaved > 0) return `${status.unsaved} waiting`;
  if (status.lastSyncAt) return `Synced ${formatRelative(status.lastSyncAt)}`;
  return "Not synced yet";
}

const platformName = (p: string) => (p === "ios" ? "iPhone or iPad" : p === "android" ? "Android phone or tablet" : p === "web" ? "Browser" : "Mac");

const HEALTH = [
  { key: "unreadable", title: "Can't be read", icon: "triangleAlert", why: "These files are damaged, only half written, or were saved with a different passphrase. Folevi never writes over them and keeps trying. A copy that's fine on another device fixes them when it syncs." },
  { key: "downloading", title: "Still downloading", icon: "cloudDownload", why: "Your sync service hasn't brought these to this device yet. They open as soon as they arrive." },
  { key: "waiting", title: "Waiting for another device", icon: "hourglass", why: "Another device mentioned these, such as a picture or a synced block, but hasn't synced them yet. They appear after it does." },
] as const;

const LOCK_AFTER = [
  { value: 0, label: "Right away" },
  { value: 60, label: "After 1 minute" },
  { value: 300, label: "After 5 minutes" },
  { value: 900, label: "After 15 minutes" },
  { value: 3600, label: "After 1 hour" },
];

function lockName(method: ShellLockSettings["method"]): string {
  if (method === "biometric") return "your fingerprint or face";
  if (method === "screenLock") return "your screen lock";
  if (method === "none") return shell()?.platform === "android" ? "your fingerprint or face" : deviceWords().ios ? "Face ID" : "Touch ID";
  return method === "faceID" ? "Face ID" : method === "opticID" ? "Optic ID" : method === "passcode" ? "your passcode" : "Touch ID";
}

/** What the host knows (the library's description, the cloud connection, the lock), read again on change. */
class HostFacts {
  info: LibraryInfo | null = null;
  cloud: CloudStatus | null = null;
  lock: ShellLockSettings | null = null;
  readonly changed = new Emitter();
  private offCloud: (() => void) | null = null;
  read(): void {
    const s = shell();
    void s?.library.info().then((i) => this.set(() => (this.info = i)), () => undefined);
    void s?.lock?.getSettings().then((l) => this.set(() => (this.lock = l)), () => undefined);
    const cloud = s?.library.cloud;
    if (cloud && !this.offCloud) {
      void cloud.status().then((c) => this.set(() => (this.cloud = c)), () => undefined);
      this.offCloud = cloud.onStatus((c) => this.set(() => (this.cloud = c)));
    }
  }
  private set(f: () => void) {
    f();
    this.changed.emit();
  }
  dispose(): void {
    this.offCloud?.();
    this.offCloud = null;
  }
}
const facts = new HostFacts();

/** Every 30 seconds, for words like "Synced 2 min ago". */
const minute = new Emitter((emit) => {
  const t = setInterval(emit, 30_000);
  return () => clearInterval(t);
});

export function libraryValue(deps: EngineDeps, info: LibraryInfo | null, status: LibraryStatus | null, cloud: CloudStatus | null, lock: ShellLockSettings | null) {
  const where = info ?? status?.info ?? null;
  const provider = where ? providerOf(where.kind) : null;
  const here = deviceWords();
  const pname = provider ? providerName(provider) : "";
  const cs = provider && cloud?.provider === provider ? cloud : null;
  const cstate = cs?.state ?? "none";
  const total = status ? status.health.unreadable.length + status.health.downloading.length + status.health.waiting.length : 0;
  const lockOn = Boolean(lock?.lock);
  const unavailable = lock?.method === "none";
  const name = lock ? lockName(lock.method) : "";
  return {
    local: deps.app.mode === "local",
    place: {
      kind: where ? placeName(where.kind) : "…",
      path: where?.displayPath || "…",
      status: syncLine(status),
      problem: status?.error && status.state !== "unavailable" ? status.error : null,
      canSync: Boolean(control(deps)) && status?.state !== "locked",
      canMove: Boolean(where),
      connection: provider
        ? {
            provider,
            name: pname,
            state: cstate,
            text:
              cstate === "connected" || cstate === "offline"
                ? `Connected as ${cs?.account ?? `your ${pname} account`}`
                : cstate === "reconnect"
                  ? `${pname} stopped letting Folevi in (the access was removed or it expired). Reconnect to keep syncing. Your notes are safe on ${here.here} meanwhile.`
                  : `Not connected to ${pname}. Your notes are kept on ${here.here} and sync once you connect again.`,
            account: cs?.account ?? `your ${pname} account`,
            offline: cstate === "offline" ? `. Offline: changes go up when ${here.here} is back online.` : null,
            connectLabel: cstate === "reconnect" ? `Reconnect ${pname}` : `Connect ${pname}`,
            canConnect: cstate !== "connected" && cstate !== "offline",
            canSignOut: cstate !== "none",
            signInWait: `Finish signing in to ${pname} in ${here.signInPlace}.`,
          }
        : null,
      moveChoices: placeOptions(cloud?.available ?? null).filter((p) => p.kind !== where?.kind),
    },
    devices: status
      ? status.devices.map((d) => ({
          id: d.deviceId,
          phone: d.platform === "ios" || d.platform === "android",
          name: d.name && d.name !== "This device" ? d.name : d.thisDevice ? platformName(d.platform) : `Another ${platformName(d.platform)}`,
          here: d.thisDevice ? here.Here : null,
          detail: `${platformName(d.platform)}${d.appVersion ? ` · Folevi ${d.appVersion}` : ""}`,
          when: d.thisDevice && status.syncing ? "Syncing…" : `Last synced ${formatRelative(d.lastSeen)}`,
        }))
      : null,
    health: status
      ? {
          description: total === 0 ? `Every file in the library could be read. ${status.notes.total} ${status.notes.total === 1 ? "note" : "notes"} on ${thisDevice()}.` : "Some files need a moment, or need a look.",
          clean: total === 0,
          groups: HEALTH.filter((h) => status.health[h.key].length).map((h) => ({
            key: h.key,
            title: h.title,
            icon: h.icon,
            why: h.why,
            count: status.health[h.key].length,
            items: status.health[h.key].slice(0, 20).map((i) => ({ path: i.path, title: i.title, since: `since ${formatRelative(i.since)}`, detail: i.detail ?? null })),
            more: status.health[h.key].length > 20 ? `and ${status.health[h.key].length - 20} more` : null,
          })),
        }
      : null,
    passphrase:
      where && passphraseHere()
        ? {
            encrypted: Boolean(where.encrypted),
            description: where.encrypted
              ? "The library is encrypted. Its files can't be read without the passphrase, by anyone, including Folevi."
              : "Encrypt the library's files so the synced copy can't be read without a passphrase. If the passphrase is lost, the synced copy can't be recovered.",
            min: MIN_PASSPHRASE,
          }
        : null,
    lock: lock
      ? {
          on: lockOn,
          unavailable,
          label: `Lock Folevi with ${name}`,
          description: unavailable
            ? `${here.Here} has no ${here.ios ? "Face ID or passcode" : shell()?.platform === "android" ? "fingerprint, face or screen lock" : "Touch ID"}, or it isn't set up in ${here.settings}, so Folevi can't lock.`
            : `Folevi asks for ${name} when it opens, and when you come back to it. It covers your notes until then.`,
          after: lock.lockAfter,
          afterLabel: LOCK_AFTER.find((o) => o.value === lock.lockAfter)?.label ?? `${lock.lockAfter} seconds`,
          choices: LOCK_AFTER,
        }
      : null,
    ai: {
      description: `In a library on your devices, Foli AI runs on ${here.onDeviceModel} on ${here.here}, or on your own OpenAI, Anthropic or Google key, called straight from ${here.here}.`,
      keysWhere: `. Keys stay ${shell()?.platform === "android" ? "sealed by the Android Keystore" : "in the Keychain"} on ${here.here}; Folevi never sees them.`,
    },
    // The iPhone's own words for the same facts (LibrarySection.tsx's iPhone rows: a value short enough for a row,
    // the explanations as the groups' footers).
    phone: {
      status: shortStatus(status),
      problem: status?.state === "unavailable" ? syncLine(status) : status?.error ? `Last problem: ${status.error}` : null,
      locationFooter: `The folder Folevi keeps your notes in. ${here.files === "Finder" ? "Finder" : "The Files app"} shows it too.`,
      devices: status
        ? status.devices.map((d) => ({
            id: d.deviceId,
            phone: d.platform === "ios" || d.platform === "android",
            name: d.name && d.name !== "This device" ? d.name : d.thisDevice ? platformName(d.platform) : `Another ${platformName(d.platform)}`,
            description: `${d.thisDevice ? `${here.Here} · ` : ""}${d.appVersion ? `Folevi ${d.appVersion}` : platformName(d.platform)}`,
            value: d.thisDevice && status.syncing ? "Syncing…" : formatRelative(d.lastSeen),
          }))
        : null,
      lockLabel: `Lock with ${name}`,
      aiFooter: `Foli AI runs on ${here.onDeviceModel} on ${here.here}, or on your own OpenAI, Anthropic or Google key. Keys stay ${shell()?.platform === "android" ? "sealed by the Android Keystore" : "in the Keychain"} on ${here.here}; Folevi never sees them.`,
    },
    forget: shell()?.places
      ? {
          title: `Remove from ${here.here}`,
          description: `Folevi stops showing this library on ${here.here}. Its folder stays exactly as it is, with every note in it, and other devices keep using it.`,
          button: `Remove from ${here.here}…`,
          dialogTitle: `Remove the library from ${here.here}?`,
          dialogDescription: "What's waiting is written to the folder first. Nothing in the folder is deleted: set the library up again on the same folder to bring it back.",
        }
      : null,
  };
}

// ---- Foli AI on the device (local mode) ----------------------------------------------------------------------

function onDeviceStatus(state: LocalAiState | null) {
  if (!state?.caps) return "unknown" as const;
  if (state.caps.onDevice) return "available" as const;
  return state.caps.onDeviceStatus && state.caps.onDeviceStatus !== "available" ? state.caps.onDeviceStatus : ("unknown" as const);
}

export function localAiValue(deps: EngineDeps, state: LocalAiState) {
  const here = deviceWords();
  const profile = deps.app.profileData as { aiEnabled?: boolean; aiPrefs?: { history?: boolean } };
  const host = localAiHost();
  const status = onDeviceStatus(state);
  const caps = state.caps;
  const choices = PROVIDER_ORDER.filter((p) => usable(caps, p));
  const picked = state.choice && usable(caps, state.choice.provider) ? state.choice : null;
  const active = state.active;
  const models = active && active.provider !== "on-device" ? PROVIDERS[active.provider].models : [];
  return {
    hosted: Boolean(host.ai),
    loaded: state.loaded,
    on: profile.aiEnabled !== false,
    history: profile.aiPrefs?.history !== false,
    onText: `Foli AI helps you write, answers from your notes and sums them up. In a library on your devices it runs on ${here.onDeviceModel} on ${here.here}, or on your own key with OpenAI, Anthropic or Google, called straight from ${here.here}. Nothing goes through Folevi, and nothing is sent while it's off.`,
    checking: `Checking Foli AI on ${here.here}…`,
    onDevice: {
      title: `On ${here.here}`,
      status,
      name: status === "available" ? here.onDeviceModel : `${here.onDeviceModel} isn't available`,
      text: ON_DEVICE_COPY[status],
      more: status === "available" ? "It's a small model: it does writing help, questions about your notes, chats and the smaller block tools. Long notes are cut to what it can read, and wireframes and flowcharts need your own key." : null,
    },
    keysDescription: `With your own key, Foli AI uses that provider's models, called straight from ${here.here} under your account with them. Your keys stay in ${here.here}'s Keychain: Folevi never sees them.`,
    keys: KEY_PROVIDERS.map((p) => {
      const stored = Boolean(caps?.keys[PROVIDERS[p].secret!]);
      return {
        provider: p,
        label: PROVIDERS[p].label,
        stored,
        status: stored ? `Key added. It's kept in ${here.here}'s Keychain and can't be shown again.` : "No key.",
        canTest: Boolean(host.ai?.testKey),
        canAdd: Boolean(host.secrets),
        keyUrl: PROVIDERS[p].keyUrl ?? null,
      };
    }),
    model: choices.length
      ? {
          missing: null,
          description: `Which model answers. Folevi picks ${here.onDeviceModel} when it's on, and otherwise the first key you added.`,
          providers: [{ value: "auto", label: "Let Folevi pick" }, ...choices.map((p) => ({ value: p, label: PROVIDERS[p].label }))],
          provider: picked?.provider ?? "auto",
          modelLabel: models.length ? `${PROVIDERS[active!.provider].label} model` : null,
          models: models.length ? [...models.map((m) => ({ value: m.id, label: m.label })), ...(models.some((m) => m.id === active!.model) ? [] : [{ value: active!.model, label: active!.model }])] : [],
          model: active?.model ?? null,
          note: models.find((m) => m.id === active?.model)?.note ?? "",
          answering: active ? `Answering now: ${active.provider === "on-device" ? `${here.onDeviceModel}, on ${here.here}` : `${modelLabel(active.provider, active.model)} (${PROVIDERS[active.provider].label})`}.` : null,
        }
      : {
          missing: `Foli AI has no model on ${here.here} yet. ${here.ios || shell()?.platform === "mac" ? `Turn on ${here.onDeviceModel}, or add one of your own keys.` : "Add one of your own keys."}`,
          description: null,
          providers: [],
          provider: "auto",
          modelLabel: null,
          models: [],
          model: null,
          note: "",
          answering: null,
        },
    // The iPhone's own words (LocalAiSection.tsx IphoneLocalAi).
    phone: {
      onText: `Foli AI helps you write, answers from your notes and sums them up. It runs on ${here.onDeviceModel} on ${here.here}, or on your own key with OpenAI, Anthropic or Google, called straight from ${here.here}. Nothing goes through Folevi, and nothing is sent while it's off.`,
      onDeviceValue: state.loaded === false ? "Checking…" : status === "available" ? "On" : "Not available",
      onDeviceFooter: `${ON_DEVICE_COPY[status]}${status === "available" ? " It's a small model: it does writing help, questions about your notes, chats and the smaller block tools. Long notes are cut to what it can read, and wireframes and flowcharts need your own key." : ""}`,
      historyText: `Your Foli AI conversations are kept on ${here.here} so you can come back to them, rename, pin and search them. They aren't synced with your library. When this is off, a conversation is deleted as soon as you close it.`,
      noHost: "Foli AI in a library on your devices needs Folevi for Mac: it runs on Apple Intelligence there, or on your own key.",
      phoneDevice: here.noun !== "Mac",
    },
    historyText: `Your Foli AI conversations are kept on ${here.here} so you can come back to them, rename, pin and search them. They stay on this device and aren't synced with your library. When this is off, a conversation is deleted as soon as you close it.`,
    memory: Boolean(active),
  };
}

// ---- the Mac app's own settings (Settings > Desktop app) -------------------------------------------------------

let desktopState: { settings: DesktopSettings; error: string | null } | null = null;
const desktopChanged = new Emitter();
function readDesktop() {
  void desktop()
    ?.getSettings()
    .then((s) => {
      desktopState = s;
      desktopChanged.emit();
    }, () => undefined);
}

export function desktopValue(state: { settings: DesktopSettings; error: string | null } | null) {
  if (!desktop()) return { bridge: false, loaded: false, settings: null };
  if (!state) return { bridge: true, loaded: false, settings: null };
  const s = state.settings;
  return {
    bridge: true,
    loaded: true,
    settings: {
      quickAddShortcut: s.quickAddShortcut,
      shortcutLabel: shortcutLabel(s.quickAddShortcut),
      defaultShortcut: DEFAULT_QUICK_ADD_SHORTCUT,
      defaultLabel: shortcutLabel(DEFAULT_QUICK_ADD_SHORTCUT),
      error: state.error,
      openAtLogin: s.openAtLogin,
      menuBarIcon: s.menuBarIcon,
      notifications: s.notifications,
    },
  };
}

// ---- Convex functions the account's sections call (allowlist) --------------------------------------------------

/** Queries by name (as the web's components call them). */
const QUERIES = {
  "aiMemory.list": api.aiMemory.list,
  "billing.mine": api.billing.mine,
  "workspaceBilling.summary": api.workspaceBilling.summary,
  "mcp.listGrants": api.mcp.listGrants,
  "apiTokens.list": api.apiTokens.list,
  "webhooks.list": api.webhooks.list,
  "workspaces.members": api.workspaces.members,
  "workspaces.guests": api.workspaces.guests,
} as const;
const MUTATIONS = {
  "aiMemory.add": api.aiMemory.add,
  "aiMemory.update": api.aiMemory.update,
  "aiMemory.remove": api.aiMemory.remove,
  "aiMemory.clear": api.aiMemory.clear,
  "users.updateProfile": api.users.updateProfile,
  "users.requestAccountDeletion": api.users.requestAccountDeletion,
  "users.cancelAccountDeletion": api.users.cancelAccountDeletion,
  "mcp.revokeGrant": api.mcp.revokeGrant,
  "apiTokens.create": api.apiTokens.create,
  "apiTokens.revoke": api.apiTokens.revoke,
  "webhooks.create": api.webhooks.create,
  "webhooks.remove": api.webhooks.remove,
  "webhooks.setEnabled": api.webhooks.setEnabled,
  "webhooks.sendTest": api.webhooks.sendTest,
  "workspaces.rename": api.workspaces.rename,
  "workspaces.scheduleDeletion": api.workspaces.scheduleDeletion,
  "workspaces.removeMember": api.workspaces.removeMember,
  "workspaces.changeRole": api.workspaces.changeRole,
  "workspaces.invite": api.workspaces.invite,
  "workspaces.revokeInvite": api.workspaces.revokeInvite,
  "workspaces.convertGuestToMember": api.workspaces.convertGuestToMember,
  "workspaces.removeGuest": api.workspaces.removeGuest,
} as const;
const ACTIONS = {
  "exports.exportScope": api.exports.exportScope,
  "billing.portal": api.billing.portal,
  "workspaceBilling.portal": api.workspaceBilling.portal,
} as const;
export const SETTINGS_CONVEX = { queries: Object.keys(QUERIES), mutations: Object.keys(MUTATIONS), actions: Object.keys(ACTIONS) };

// ---- the view ---------------------------------------------------------------------------------------------------

const settingsQuery: ValueViewDef = {
  kind: "value",
  parse: (args) => {
    only(args, ["key", "args"]);
    const key = oneOf(args, "key", SETTINGS_QUERY_KEYS);
    const a = obj(args.args);
    if (key === "convex") {
      const fn = str(a, "fn");
      if (!(fn in QUERIES)) throw new BridgeError("invalid_args", `${fn} isn't a query Settings reads.`);
    }
    return { key, args: a };
  },
  create: (ctx: ViewContext, args) => {
    const key = args.key as SettingsQueryKey;
    const a = args.args as Args;
    const deps = ctx.deps();
    const ok = (value: unknown) => ({ value: { data: value }, stale: false, error: null });
    switch (key) {
      case "library": {
        facts.read();
        const c = control(deps);
        const statusSignal: Signal = signalOf(c ? c.subscribe : null);
        return {
          signals: [ctx.appSignal, facts.changed, statusSignal, minute],
          compute: () => ok(libraryValue(ctx.deps(), facts.info, control(ctx.deps())?.status() ?? null, facts.cloud, facts.lock)),
        };
      }
      case "localAi":
        return { signals: [ctx.appSignal, signalOf(subscribeLocalAi)], compute: () => ok(localAiValue(ctx.deps(), localAiState())) };
      case "desktop":
        readDesktop();
        return { signals: [desktopChanged], compute: () => ok(desktopValue(desktopState)) };
      case "convex": {
        const src = source<unknown>(ctx, QUERIES[str(a, "fn") as keyof typeof QUERIES], obj(a.args), null);
        return {
          signals: [src],
          compute: () => {
            const s = src.snapshot();
            return { value: s.value === undefined ? undefined : { data: s.value }, stale: s.stale, error: s.error };
          },
        };
      }
    }
  },
};

// ---- the command ------------------------------------------------------------------------------------------------

async function lockSet(patch: Partial<Pick<ShellLockSettings, "lock" | "lockAfter">>) {
  const lock = shell()?.lock;
  if (!lock) throw new BridgeError("unavailable", "This device can't lock Folevi.");
  try {
    facts.lock = await lock.setSettings(patch);
    facts.changed.emit();
  } catch (e) {
    if (hostError(e).code === "cancelled") return { cancelled: true };
    throw new BridgeError("failed", hostError(e).message || "Couldn't change the lock.");
  }
  return { ok: true };
}

async function hostCall<T>(run: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const h = hostError(e);
    if (h.code === "cancelled") throw new BridgeError("cancelled", "Cancelled.");
    throw new BridgeError("failed", h.message || fallback);
  }
}

/** Files the Mac sends (base64), as the File objects the web's import reads (a folder's files keep their path). */
function filesOf(a: Args): File[] {
  const list = Array.isArray(a.files) ? a.files : [];
  if (!list.length || list.length > 5000) throw new BridgeError("invalid_args", "Choose between 1 and 5,000 files.");
  return list.map((raw) => {
    const f = obj(raw);
    const name = str(f, "name");
    const bin = atob(str(f, "data"));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], name, { type: typeof f.type === "string" ? f.type : "" });
    if (typeof f.path === "string" && f.path) Object.defineProperty(file, "webkitRelativePath", { value: f.path });
    return file;
  });
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

async function runKey(deps: EngineDeps, key: SettingsRunKey, a: Args): Promise<unknown> {
  const lib = shell()?.library;
  switch (key) {
    case "library.syncNow": {
      const c = control(deps);
      if (!c) throw new BridgeError("unavailable", "Couldn't sync. Try again.");
      await hostCall(() => c.syncNow(), "Couldn't sync. Try again.");
      return { message: "Library synced" };
    }
    case "library.move": {
      const kind = oneOf(a, "kind", ["icloud", "folder", "device", "dropbox", "gdrive"] as const) as LibraryKind;
      try {
        const next = await movePlace(kind, () => undefined);
        facts.read();
        return next && next.kind === kind ? { moved: true, message: `Library moved to ${placeName(next.kind)}` } : { moved: false };
      } catch (e) {
        throw new BridgeError("failed", placeProblem(kind, e));
      }
    }
    case "library.cloudConnect": {
      const provider = oneOf(a, "provider", ["dropbox", "googleDrive"] as const);
      try {
        await shell()?.library.cloud?.connect(provider);
      } catch (e) {
        if (hostError(e).code === "cancelled") return { cancelled: true };
        throw new BridgeError("failed", placeProblem(kindOf(provider), e));
      }
      return { message: `Connected to ${providerName(provider)}` };
    }
    case "library.cloudCancel":
      await shell()?.library.cloud?.cancel();
      return { ok: true };
    case "library.cloudSignOut": {
      const name = facts.cloud?.provider ? providerName(facts.cloud.provider) : "";
      await hostCall(async () => shell()?.library.cloud?.signOut(), "Couldn't sign out. Try again.");
      return { message: `Signed out of ${name}` };
    }
    case "library.setPassphrase": {
      const p = str(a, "passphrase");
      await hostCall(async () => lib?.setPassphrase(p), "Couldn't encrypt the library. Try again.");
      facts.read();
      return { message: "The library is encrypted" };
    }
    case "library.changePassphrase": {
      const current = str(a, "current"), next = str(a, "passphrase");
      const ok = await hostCall(async () => lib?.changePassphrase(current, next), "Couldn't change the passphrase. Try again.");
      if (!ok) throw new BridgeError("wrong_passphrase", "The current passphrase isn't right.");
      facts.read();
      return { message: "Passphrase changed" };
    }
    case "library.removePassphrase": {
      const current = str(a, "current");
      const unlocked = await hostCall(async () => lib?.unlock(current), "Couldn't remove the passphrase. Try again.");
      if (!unlocked) throw new BridgeError("wrong_passphrase", "That passphrase isn't right.");
      await hostCall(async () => lib?.setPassphrase(null), "Couldn't remove the passphrase. Try again.");
      facts.read();
      return { message: "The library isn't encrypted any more" };
    }
    case "library.lock": {
      const patch: Partial<Pick<ShellLockSettings, "lock" | "lockAfter">> = {};
      if (typeof a.lock === "boolean") patch.lock = a.lock;
      if (typeof a.lockAfter === "number") patch.lockAfter = a.lockAfter;
      return await lockSet(patch);
    }
    case "library.forget": {
      await control(deps)?.flush();
      const { closeLocalLibrary } = await import("@/lib/local/index");
      await closeLocalLibrary();
      const all = (await indexedDB.databases?.()) ?? [];
      await Promise.all(
        all
          .filter((d) => d.name?.startsWith("folevi-local-"))
          .map((d) => new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(d.name!);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          })),
      );
      await hostCall(async () => shell()?.places?.forgetLibrary(), "Folevi couldn't remove the library.");
      return { ok: true };
    }
    case "localAi.setKey": {
      const provider = oneOf(a, "provider", KEY_PROVIDERS) as AiKeyProvider;
      const info = PROVIDERS[provider];
      const key = cleanKey(str(a, "key"));
      if (!key) throw new BridgeError("invalid_key", `That doesn't look like a whole ${info.label} key. Paste it again.`);
      const secrets = localAiHost().secrets;
      if (!secrets || !info.secret) throw new BridgeError("unavailable", "Keys can't be kept on this device.");
      await secrets.set(info.secret, key);
      await refreshLocalAi();
      return { message: `${info.label} key added` };
    }
    case "localAi.removeKey": {
      const provider = oneOf(a, "provider", KEY_PROVIDERS) as AiKeyProvider;
      const info = PROVIDERS[provider];
      const secrets = localAiHost().secrets;
      if (!secrets || !info.secret) throw new BridgeError("unavailable", "Keys can't be kept on this device.");
      await secrets.delete(info.secret);
      await refreshLocalAi();
      return { message: `${info.label} key removed` };
    }
    case "localAi.testKey": {
      const provider = oneOf(a, "provider", KEY_PROVIDERS) as AiKeyProvider;
      const test = localAiHost().ai?.testKey;
      if (!test) throw new BridgeError("unavailable", "Keys can't be tested here.");
      try {
        const r = await test(provider);
        return r.ok ? { ok: true, text: `Your ${PROVIDERS[provider].label} key works.` } : { ok: false, text: r.error };
      } catch (e) {
        return { ok: false, text: e instanceof Error ? e.message : String(e) };
      }
    }
    case "localAi.setChoice": {
      const provider = a.provider === undefined || a.provider === "auto" ? null : (oneOf(a, "provider", PROVIDER_ORDER) as AiProviderId);
      const model = provider ? (typeof a.model === "string" ? a.model : PROVIDERS[provider].defaultModel) : null;
      const s = await setLocalAiChoice(provider && model ? { provider, model } : null);
      return { message: s.active ? `Foli AI uses ${modelLabel(s.active.provider, s.active.model)}` : "Saved" };
    }
    case "desktop.set": {
      const bridge = desktop();
      if (!bridge) throw new BridgeError("unavailable", "These settings are for the Folevi Mac app.");
      const patch: Partial<DesktopSettings> = {};
      if (typeof a.quickAddShortcut === "string") patch.quickAddShortcut = a.quickAddShortcut;
      for (const k of ["openAtLogin", "menuBarIcon", "notifications"] as const) if (typeof a[k] === "boolean") patch[k] = a[k] as boolean;
      const next = await bridge.setSettings(patch);
      if (next) {
        desktopState = next;
        desktopChanged.emit();
      }
      return { ok: true };
    }
    case "desktop.pauseShortcut":
      desktop()?.pauseShortcut(a.paused === true);
      return { ok: true };
    case "text.lines": {
      // Where the web breaks a paragraph into lines (`p { text-wrap: pretty }` in globals.css), for native text to
      // break at the same words: each text laid out in this page at its width and type, the last word of each line.
      const list = Array.isArray(a.texts) ? a.texts.slice(0, 200) : [];
      const box = document.createElement("div");
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
      document.body.appendChild(box);
      try {
        return {
          lines: list.map((raw) => {
            const t = obj(raw);
            const p = document.createElement("p");
            p.style.cssText = `margin:0;width:${Number(t.width)}px;font-size:${Number(t.size)}px;line-height:${Number(t.leading)}px;font-weight:${Number(t.weight)};letter-spacing:${Number(t.tracking)}px;${t.display ? "font-family:var(--font-display),Spectral,serif;" : ""}text-wrap:${t.balance ? "balance" : "pretty"}`;
            p.textContent = String(t.text ?? "");
            box.appendChild(p);
            const node = p.firstChild;
            const breaks: number[] = [];
            if (node) {
              const r = document.createRange();
              let top: number | null = null;
              let n = 0;
              for (const m of String(t.text).matchAll(/\S+/g)) {
                r.setStart(node, m.index!);
                r.setEnd(node, m.index! + 1);
                const y = Math.round(r.getBoundingClientRect().top);
                if (top !== null && y !== top) breaks.push(n - 1);
                top = y;
                n++;
              }
            }
            p.remove();
            return breaks;
          }),
        };
      } finally {
        box.remove();
      }
    }
    case "data.import": {
      const scope: WireScope = typeof a.workspaceId === "string" ? { kind: "workspace", workspaceId: a.workspaceId } : { kind: "personal" };
      const notes: string[] = [];
      const results = await importFiles(deps.client as never, scope, filesOf(a), {
        importText: (x) => deps.client.mutation(api.imports.importText, x) as never,
        createFolder: (x) => deps.client.mutation(api.organization.createFolder, x),
        onNote: (m) => notes.push(m),
      });
      const ok = results.filter((r) => r.id).length;
      return { results, notes, ok, message: `Imported ${ok} of ${results.length} ${results.length === 1 ? "page" : "pages"}`, allOk: ok === results.length };
    }
    case "takeout.import": {
      const [file] = filesOf(a);
      const zip = new Uint8Array(await file!.arrayBuffer());
      const client = deps.client as unknown as MigrationClient;
      const local = (deps.client as unknown as { local?: { putFile: Parameters<typeof libraryPutFile>[0]["putFile"] } }).local;
      const device = (await loadDeviceId(deps.app.accountKey).catch(() => null)) ?? "takeout-import";
      const target = clientTarget(client, { deviceId: device, putFile: local ? libraryPutFile(local) : accountUpload(client) });
      try {
        const { state, folder } = await importTakeout({ zip, target });
        const missing = state.problems.filter((p) => p.kind === "file").length;
        return { message: "Takeout imported", status: `${plural(Object.keys(state.notes).length, "note")} came in, in the folder “${folder.name}”.${missing ? ` ${plural(missing, "file")} didn't come along.` : ""}` };
      } catch (e) {
        throw new BridgeError("failed", e instanceof Error ? e.message : String(e));
      }
    }
    case "convex.mutation": {
      const fn = str(a, "fn");
      if (!(fn in MUTATIONS)) throw new BridgeError("invalid_args", `${fn} isn't a change Settings makes.`);
      return await deps.client.mutation(MUTATIONS[fn as keyof typeof MUTATIONS], obj(a.args) as never);
    }
    case "convex.action": {
      const fn = str(a, "fn");
      if (!(fn in ACTIONS)) throw new BridgeError("invalid_args", `${fn} isn't an action Settings runs.`);
      return await deps.client.action(ACTIONS[fn as keyof typeof ACTIONS], obj(a.args) as never);
    }
  }
}

export const SETTINGS_VALUE_VIEWS = {
  "settings.query": settingsQuery,
} satisfies Partial<Record<ViewName, ValueViewDef>>;

export const SETTINGS_COMMANDS = {
  "settings.run": {
    async run(deps, args) {
      only(args, ["key", "args"]);
      const key = oneOf(args, "key", SETTINGS_RUN_KEYS);
      const data = await runKey(deps, key, obj(args.args));
      return { data: data ?? null };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
