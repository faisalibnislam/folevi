// "Your own AI key" (docs/PRICING_PLAN.md, "Bring your own AI"; docs/AI_ASSISTANT.md, "Your own AI key"):
// Foli AI on the person's own Anthropic, OpenAI or Google Gemini key, on any plan, with no credits.
//
// Where the key lives on this device:
//   - In an app (the Mac app today): the system keychain, under the same names local mode uses (`ai.anthropic`,
//     `ai.openai`, `ai.google`, lib/local/ai/catalog.ts). A host that can hand it back for Folevi Cloud requests
//     has `secrets.reveal`; one that can't yet gets a copy in the page's store too.
//   - In a browser: IndexedDB, encrypted with an AES-GCM key the browser made and won't export. It keeps the
//     key out of plain storage dumps; it can't stop a script running in this page, so keys never leave the
//     device except with a request.
//
// On Folevi Cloud the key goes with each AI request (an action's `ownKey` argument, over TLS) and the server
// uses it for that request only (convex/lib/ai/ownKey.ts). Which provider is on and the model picked are kept
// on this device (localStorage); the key is never shown again once saved.
import { openDB, type IDBPDatabase } from "idb";
import { shell } from "@/lib/shell";
import type { SecretName } from "@/lib/shell/types";
import { PROVIDERS as CATALOG, type ModelInfo } from "@/lib/local/ai/catalog";

/** The providers as Folevi Cloud names them (local mode says "google" for Gemini). */
export type OwnKeyProvider = "anthropic" | "openai" | "gemini";
export const OWN_KEY_PROVIDERS: readonly OwnKeyProvider[] = ["anthropic", "openai", "gemini"];

export interface OwnKeyProviderInfo {
  id: OwnKeyProvider;
  label: string;
  secret: SecretName;
  models: ModelInfo[];
  defaultModel: string;
  keyUrl?: string;
  keyPattern?: RegExp;
}

const catalogOf = (p: OwnKeyProvider) => CATALOG[p === "gemini" ? "google" : p];

export const OWN_KEY_INFO: Record<OwnKeyProvider, OwnKeyProviderInfo> = Object.fromEntries(
  OWN_KEY_PROVIDERS.map((id) => {
    const c = catalogOf(id);
    return [id, { id, label: id === "gemini" ? "Google Gemini" : c.label, secret: c.secret!, models: c.models, defaultModel: c.defaultModel, keyUrl: c.keyUrl, keyPattern: c.keyPattern }];
  }),
) as Record<OwnKeyProvider, OwnKeyProviderInfo>;

/** What the person turned on: a provider and its model. */
export interface OwnKeyChoice {
  provider: OwnKeyProvider;
  model: string;
}

/** What goes with a Folevi Cloud request (convex/lib/ai/ownKey.ts vOwnKey). */
export interface OwnKeyArg {
  provider: OwnKeyProvider;
  apiKey: string;
  model?: string;
}

const CHOICE = "folevi:own-ai-key";
const DB = "folevi-own-ai-key";
const listeners = new Set<() => void>();

const isProvider = (p: unknown): p is OwnKeyProvider => typeof p === "string" && (OWN_KEY_PROVIDERS as readonly string[]).includes(p);

/** A key as people paste it: no spaces inside, a plausible length. The provider decides for real (Test key). */
export function cleanOwnKey(raw: string): string | null {
  const key = raw.trim();
  return /^[\x21-\x7e]{16,400}$/.test(key) ? key : null;
}

export function ownKeyChoice(): OwnKeyChoice | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHOICE) ?? "null") as Partial<OwnKeyChoice> | null;
    if (!v || !isProvider(v.provider)) return null;
    return { provider: v.provider, model: typeof v.model === "string" && v.model ? v.model : OWN_KEY_INFO[v.provider].defaultModel };
  } catch {
    return null;
  }
}

/** Turns Foli AI on the person's own key on (a provider and model) or off (null). */
export function setOwnKeyChoice(choice: OwnKeyChoice | null): void {
  try {
    if (choice) localStorage.setItem(CHOICE, JSON.stringify(choice));
    else localStorage.removeItem(CHOICE);
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
  for (const l of listeners) l();
}

/** Hears every change to the choice or the stored keys (Settings and the usage card redraw). */
export function onOwnKeyChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------------------------------------------------------------------------------------------------
// The page's store: IndexedDB, each key sealed with a browser-made AES-GCM key that can't be exported
// ---------------------------------------------------------------------------------------------------

type Sealed = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };
let db: Promise<IDBPDatabase> | null = null;

function store(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === "undefined" || typeof crypto === "undefined" || !crypto.subtle) return null;
  db ??= openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore("keys");
    },
  });
  return db;
}

async function wrappingKey(d: IDBPDatabase): Promise<CryptoKey> {
  const existing = (await d.get("keys", "wrap")) as CryptoKey | undefined;
  if (existing) return existing;
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await d.put("keys", k, "wrap");
  return k;
}

async function pageSet(provider: OwnKeyProvider, key: string): Promise<void> {
  const d = await store();
  if (!d) throw new Error("This browser can't keep a key.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrappingKey(d), new TextEncoder().encode(key));
  await d.put("keys", { iv, data } satisfies Sealed, provider);
}

async function pageGet(provider: OwnKeyProvider): Promise<string | null> {
  const d = await store();
  if (!d) return null;
  const sealed = (await d.get("keys", provider)) as Sealed | undefined;
  if (!sealed) return null;
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, await wrappingKey(d), sealed.data));
  } catch {
    return null;
  }
}

async function pageDelete(provider: OwnKeyProvider): Promise<void> {
  const d = await store();
  if (d) await d.delete("keys", provider);
}

/** Forgets every key this browser keeps (signing out of this device). The app's keychain is untouched. */
export async function clearPageOwnKeys(): Promise<void> {
  // This page's own connection would hold the delete back.
  const open = db;
  db = null;
  if (open) (await open.catch(() => null))?.close();
  await new Promise<void>((done) => {
    try {
      const r = indexedDB.deleteDatabase(DB);
      r.onsuccess = r.onerror = r.onblocked = () => done();
    } catch {
      done();
    }
  });
  try {
    localStorage.removeItem(CHOICE);
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------------------------------
// Saving, checking and using a key
// ---------------------------------------------------------------------------------------------------

/** Saves a key on this device (the keychain in an app; the page's store where the app can't hand it back). */
export async function saveOwnKey(provider: OwnKeyProvider, key: string): Promise<void> {
  const secrets = shell()?.secrets;
  if (secrets) await secrets.set(OWN_KEY_INFO[provider].secret, key);
  if (!secrets?.reveal) await pageSet(provider, key);
  for (const l of listeners) l();
}

export async function removeOwnKey(provider: OwnKeyProvider): Promise<void> {
  const secrets = shell()?.secrets;
  if (secrets) await secrets.delete(OWN_KEY_INFO[provider].secret);
  await pageDelete(provider);
  if (ownKeyChoice()?.provider === provider) setOwnKeyChoice(null);
  for (const l of listeners) l();
}

export async function hasOwnKey(provider: OwnKeyProvider): Promise<boolean> {
  const secrets = shell()?.secrets;
  if (secrets?.reveal) return await secrets.has(OWN_KEY_INFO[provider].secret);
  return (await pageGet(provider)) !== null;
}

async function readKey(provider: OwnKeyProvider): Promise<string | null> {
  const secrets = shell()?.secrets;
  if (secrets?.reveal) return await secrets.reveal(OWN_KEY_INFO[provider].secret);
  return await pageGet(provider);
}

/** The key, provider and model to send with a Folevi Cloud request, when the person turned their own key on. */
export async function ownKeyForRequest(choice = ownKeyChoice()): Promise<OwnKeyArg | null> {
  if (!choice) return null;
  try {
    const apiKey = await readKey(choice.provider);
    return apiKey ? { provider: choice.provider, apiKey, model: choice.model } : null;
  } catch {
    return null;
  }
}

/** `{ ownKey }` to spread into an AI action's arguments, or nothing. */
export async function ownKeyArgs(): Promise<{ ownKey?: OwnKeyArg }> {
  const k = await ownKeyForRequest();
  return k ? { ownKey: k } : {};
}
