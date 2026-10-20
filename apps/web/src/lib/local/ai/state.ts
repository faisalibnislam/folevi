// Which model Foli AI uses in local mode, and what it can do (docs/LOCAL_MODE_PLAN.md §4.1, WP11). The host
// (the Mac app's main process) says whether Apple's model can run and which of the person's keys are stored
// (never the keys); the person's pick of provider and model is kept on this device. Each window keeps its own
// copy, refreshed when it opens, when the window comes forward, when another window changes the pick, and
// after Settings > AI changes a key. A change re-runs the local queries that read it (`ai:state`, volatile.ts)
// and the interface (useLocalAi).
import type { AiCaps, AiProviderId, ShellAi, ShellSecrets } from "@/lib/shell/types";
import { shell } from "@/lib/shell";
import { touchVolatile } from "../volatile";
import { KEY_PROVIDERS, MODEL_ID, ON_DEVICE_CONTEXT, PROVIDERS, isProviderId } from "./catalog";
import { featuresFor, type AiFeatures } from "./features";

/** The model requests go to, resolved from the pick and what's usable now. */
export interface ActiveModel {
  provider: AiProviderId;
  model: string;
  /** For the plumbing calls (the server's fast model). */
  fastModel: string;
  contextTokens: number;
  maxOutputTokens: number;
}

export interface LocalAiState {
  /** The host has been asked at least once. */
  loaded: boolean;
  /** This host can run Foli AI at all (the Mac app; not a plain browser). */
  host: boolean;
  caps: AiCaps | null;
  /** What the person picked in Settings > AI (null: the best one available). */
  choice: { provider: AiProviderId; model: string } | null;
  active: ActiveModel | null;
  features: AiFeatures;
}

/** Where the state comes from: the host's bridge (tests swap it). */
export interface LocalAiHost {
  ai: ShellAi | null;
  secrets: ShellSecrets | null;
}

const CHOICE_KEY = "folevi:local-ai-model";

let hostOf: () => LocalAiHost = () => {
  const s = shell();
  return { ai: s?.ai ?? null, secrets: s?.secrets ?? null };
};

function readChoice(): LocalAiState["choice"] {
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { provider?: unknown; model?: unknown };
    if (!isProviderId(v.provider) || typeof v.model !== "string" || !MODEL_ID.test(v.model)) return null;
    return { provider: v.provider, model: v.model };
  } catch {
    return null;
  }
}

function writeChoice(choice: LocalAiState["choice"]): void {
  try {
    if (choice) localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
    else localStorage.removeItem(CHOICE_KEY);
  } catch {
    /* storage blocked: the pick lasts until the window closes */
  }
}

/** Whether a provider can take requests with these capabilities. */
export function usable(caps: AiCaps | null, provider: AiProviderId): boolean {
  if (!caps) return false;
  if (provider === "on-device") return caps.onDevice;
  const secret = PROVIDERS[provider].secret;
  return Boolean(secret && caps.keys[secret]);
}

/** The model to use: the pick when it's usable, otherwise the device's model, otherwise the first key stored. */
export function resolveActive(caps: AiCaps | null, choice: LocalAiState["choice"]): ActiveModel | null {
  const provider = choice && usable(caps, choice.provider) ? choice.provider : (["on-device", ...KEY_PROVIDERS] as AiProviderId[]).find((p) => usable(caps, p));
  if (!provider) return null;
  const info = PROVIDERS[provider];
  const model = choice?.provider === provider ? choice.model : info.defaultModel;
  return {
    provider,
    model: provider === "on-device" ? info.defaultModel : model,
    fastModel: provider === "on-device" ? info.defaultModel : info.fastModel,
    contextTokens: provider === "on-device" ? Math.max(1024, caps?.onDeviceContext ?? ON_DEVICE_CONTEXT) : info.contextTokens,
    maxOutputTokens: info.maxOutputTokens,
  };
}

function build(caps: AiCaps | null, choice: LocalAiState["choice"], loaded: boolean, host: boolean): LocalAiState {
  const active = resolveActive(caps, choice);
  return { loaded, host, caps, choice, active, features: featuresFor(active?.provider ?? null) };
}

let state: LocalAiState = build(null, null, false, false);
const listeners = new Set<() => void>();
let refreshing: Promise<LocalAiState> | null = null;
let again = false;
let started = false;

function publish(next: LocalAiState) {
  const same = JSON.stringify(next) === JSON.stringify(state);
  state = next;
  if (same) return;
  touchVolatile("ai:state");
  for (const l of [...listeners]) l();
}

/** Asks the host again (after a key changed, the window came forward). Resolves with the new state. */
export function refreshLocalAi(): Promise<LocalAiState> {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      again = false;
      const { ai } = hostOf();
      let caps: AiCaps | null = null;
      if (ai) {
        try {
          caps = await ai.capabilities();
        } catch {
          caps = null;
        }
      }
      publish(build(caps, readChoice(), true, Boolean(ai)));
    } while (again);
    refreshing = null;
    return state;
  })();
  return refreshing;
}

function start() {
  if (started) return;
  started = true;
  void refreshLocalAi();
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => void refreshLocalAi());
    window.addEventListener("storage", (e) => {
      if (e.key === CHOICE_KEY) void refreshLocalAi();
    });
  }
}

/** The state now (asking the host the first time). */
export function localAiState(): LocalAiState {
  start();
  return state;
}

/** The state once the host has answered at least once (handlers wait for it). */
export async function loadedLocalAi(): Promise<LocalAiState> {
  start();
  return state.loaded ? state : await refreshLocalAi();
}

export function subscribeLocalAi(cb: () => void): () => void {
  start();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Saves the person's pick (null: let Folevi pick) on this device. */
export async function setLocalAiChoice(choice: LocalAiState["choice"]): Promise<LocalAiState> {
  if (choice && (!isProviderId(choice.provider) || !MODEL_ID.test(choice.model))) throw new Error("That model can't be used.");
  writeChoice(choice);
  return await refreshLocalAi();
}

/** The host's bridge, for Settings > AI (keys) and the provider layer. */
export function localAiHost(): LocalAiHost {
  return hostOf();
}

/** Tests: where the state comes from (null restores the shell's bridge). Resets what was known. */
export function configureLocalAiHost(next: (() => LocalAiHost) | null): void {
  hostOf = next ?? (() => {
    const s = shell();
    return { ai: s?.ai ?? null, secrets: s?.secrets ?? null };
  });
  refreshing = null;
  again = false;
  state = build(null, null, false, false);
  started = true;
}
