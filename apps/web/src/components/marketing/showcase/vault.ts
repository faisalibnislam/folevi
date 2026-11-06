// The showcase's Vault: set up once in the demo library with a made-up passcode and three made-up items, then
// locked, so the Vault chapter can open it with the passcode the way a person does. It uses the Vault's own
// encryption (lib/vault), the same calls the Vault's screens make; everything stays in this page's memory.
import { api } from "@/lib/convex/api";
import { localLibrary } from "@/lib/local";
import { libraryVaultActor, vaultSessions, type VaultClient } from "@/lib/vault/keys";
import { newItemId, sealItem, splitItem, type ItemKind } from "@/lib/vault/items";

/** The demo Vault's passcode (made up for the showcase, shown being typed). */
export const SHOWCASE_PASSCODE = "246810";

const ITEMS: Array<{ kind: ItemKind; title: string; values: Record<string, string> }> = [
  { kind: "login", title: "Studio website", values: { username: "maya@studio.example", password: "Tulip-orbit-42-lantern", website: "https://studio.example", totp: "JBSWY3DPEHPK3PXP" } },
  { kind: "apiKey", title: "Newsletter API", values: { service: "Mailer", key: "mk_live_demo_7f3c9a1e5b", environment: "Production" } },
  { kind: "login", title: "Shared Wi-Fi", values: { username: "Studio guest", password: "spring-launch-2026", website: "" } },
];

let prepared: Promise<string | null> | null = null;

/** Sets the demo Vault up (once per page) and leaves it locked. Returns its id. */
export function prepareShowcaseVault(): Promise<string | null> {
  prepared ??= (async () => {
    const client = localLibrary().client;
    const s = vaultSessions();
    s.bind(client as unknown as VaultClient, libraryVaultActor());
    const info = (await client.query(api.vault.get, { scope: { kind: "personal" } })) as { exists: boolean; id?: string; keyVersion?: number } | null;
    if (!info) return null;
    const vaultId = info.exists && info.id ? info.id : ((await client.mutation(api.vault.create, { scope: { kind: "personal" }, client: s.info() })) as { id: string }).id;
    if (!info.exists || !info.keyVersion) {
      await s.setUp(vaultId, SHOWCASE_PASSCODE);
      s.recoverySaved(vaultId);
      const version = s.currentVersion(vaultId)!;
      for (const item of ITEMS) {
        const itemId = newItemId();
        const content = splitItem(item.kind, item.title, item.values);
        await client.mutation(api.vaultItems.create, { vaultId, itemId, kind: item.kind, item: await sealItem(vaultId, itemId, version, s.keys(vaultId), content), client: s.info(vaultId) });
      }
    }
    await s.lock(vaultId, "manual");
    return vaultId;
  })().catch((e) => {
    console.warn("[showcase] The demo Vault wasn't set up:", e);
    return null;
  });
  return prepared;
}
