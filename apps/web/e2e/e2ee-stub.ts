// Helpers for the end-to-end encryption specs (docs/E2EE_DESIGN.md §11.4).
//
// Until WP6, WP7 and WP8 land, the screens run on components/e2ee/__stubs__.ts, whose state can be forced in
// development through localStorage["folevi.e2ee.stub"]. The screen-level specs use that (`stubState`) and
// pass now. The flow specs that need the real keys, router and server say so with `needsBackend`: they run
// once E2EE_BACKEND=1 is set at integration, when the stubs are deleted.
import type { BrowserContext, Page, TestType } from "@playwright/test";

export const NEEDS_BACKEND = "needs the real E2EE backend (WP2 to WP8); run with E2EE_BACKEND=1 after integration";
/** Skips a whole spec file until the real backend is integrated. */
export function needsBackend(test: TestType<object, object>) {
  test.skip(!process.env.E2EE_BACKEND, NEEDS_BACKEND);
}

const now = Date.now();
const methods = [
  { publicId: "wrap_device", kind: "device", label: "This browser", createdAt: now - 86_400_000 },
  { publicId: "wrap_rk", kind: "recoveryKey", label: "Recovery key", createdAt: now - 86_400_000 },
  { publicId: "wrap_pp", kind: "passphrase", label: "Encryption passphrase", createdAt: now - 3_600_000 },
];
const switches = { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };
const off = { ...switches, foliAi: "off" };
const space = (level: "selected" | "full", extra: object = {}) => ({ level, state: "on", switches: level === "full" ? off : switches, lockedCount: 0, keyHolders: 1, ...extra });

/** Named stub states (the shape of StubState in components/e2ee/__stubs__.ts). */
export const STUB = {
  none: {},
  encrypted: { lock: "unlocked", methods, spaces: { personal: space("selected") } },
  full: { lock: "unlocked", methods, spaces: { personal: space("full") } },
  locked: { lock: "locked", methods, spaces: { personal: space("selected") } },
  migrating: {
    lock: "unlocked",
    methods,
    spaces: { personal: { ...space("selected"), state: "enabling" } },
    migrations: { personal: { direction: "seal", phase: "history", documents: { done: 1240, total: 1800 }, history: { done: 340, total: 2100 }, files: { done: 12, total: 80, bytesLeft: 1_200_000_000 }, paused: false, failed: [{ documentId: "01JZZZZZZZZZZZZZZZZZZZZZZZ", title: "Trip notes" }] } },
  },
  approval: { lock: "unlocked", methods, spaces: { personal: space("selected") }, approvals: [{ requestId: "req_1", label: "Chrome on Windows", createdAt: now }] },
  consent: {
    lock: "unlocked",
    methods,
    spaces: { personal: space("selected") },
    consent: { notes: [{ id: "n1", title: "Welcome to Folevi", chars: 2480 }, { id: "n2", title: "Trip notes", chars: 9120 }] },
  },
} as const;
export type StubName = keyof typeof STUB;

/**
 * The first page of each tab in `context` starts with this stub state (or a custom one); reloads keep what
 * the screens changed since.
 */
export async function stubState(context: BrowserContext, state: StubName | object) {
  const value = typeof state === "string" ? STUB[state] : state;
  await context.addInitScript((v) => {
    try {
      if (location.origin === "null" || sessionStorage.getItem("folevi.e2ee.stub.seeded")) return;
      localStorage.setItem("folevi.e2ee.stub", JSON.stringify(v));
      sessionStorage.setItem("folevi.e2ee.stub.seeded", "1");
    } catch {
      // A page without storage.
    }
  }, value);
}

/** Changes the stub state of a page that's already open (the stubs module puts its setter on window in development). */
export async function setStub(page: Page, patch: object) {
  await page.evaluate((p) => (window as unknown as { __foleviE2eeStub: { set(p: object): void } }).__foleviE2eeStub.set(p), patch);
}
