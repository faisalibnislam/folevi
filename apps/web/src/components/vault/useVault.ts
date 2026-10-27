"use client";
// The Vault's state on this page for its screens: the Vault of the current place (vault.get), whether it's open on
// this device, and the device's encryption account (the Vault's keys are sealed to it; docs/VAULT_PLAN.md §3).
import { useConvex, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { getKeySession, sessionImpl } from "@/lib/e2ee/keys/session";
import { useKeySession } from "@/lib/e2ee/keys/useKeys";
import { setup } from "@/lib/e2ee/keys/setup";
import { vaultSessions, type VaultClient } from "@/lib/vault/keys";
import { DEVICE_EVENTS_FOR_UI, type VaultDeviceEvent } from "./events";

/** The place's Vault as the server describes it (null: none to see here). */
export function useVaultInfo() {
  const { scope } = useAppState();
  return useQuery(api.vault.get, { scope });
}

/**
 * Binds the page's Vault session to this device's encryption account once it's unlocked. Returns the encryption
 * state: "none" (no keys yet: the Vault makes them), "locked" (this browser must unlock encryption first),
 * "unlocking", "unlocked".
 */
export function useVaultBinding() {
  const convex = useConvex();
  const { profile } = useAppState();
  const { state } = useKeySession();
  useEffect(() => {
    if (state !== "unlocked") {
      vaultSessions().bind(convex as unknown as VaultClient, null);
      return;
    }
    try {
      const u = sessionImpl().unlocked();
      vaultSessions().bind(convex as unknown as VaultClient, { profileId: profile.id, epoch: u.epoch, account: u.account.x25519, deviceId: getKeySession().deviceId() });
    } catch {
      vaultSessions().bind(convex as unknown as VaultClient, null);
    }
  }, [convex, state, profile.id]);
  return state;
}

/** Binds the Vault session to this device's unlocked account now (not waiting for a render). */
export function bindNow(convex: unknown, profileId: string) {
  const u = sessionImpl().unlocked();
  vaultSessions().bind(convex as VaultClient, { profileId, epoch: u.epoch, account: u.account.x25519, deviceId: getKeySession().deviceId() });
}

let creating: Promise<unknown> | null = null;

/**
 * Makes this account's encryption keys quietly when it has none (the Vault needs them; the person's notes keep their
 * level), and binds the Vault session to them at once.
 */
export async function ensureEncryptionAccount(convex: unknown, profileId: string) {
  // One at a time: two screens (or a render run twice) must never make two accounts.
  if (getKeySession().state() === "none") {
    creating ??= setup.createAccount().finally(() => (creating = null));
    await creating;
  }
  bindNow(convex, profileId);
}

/** The recovery key a Vault still has to show (it survives page redraws until saved). */
export function useRecoveryToSave(vaultId: string | null): string | null {
  const s = vaultSessions();
  return useSyncExternalStore(
    (cb) => s.subscribe(cb),
    () => (vaultId ? s.recoveryFor(vaultId) : null),
    () => null,
  );
}

/** Whether a Vault is open on this device, re-rendering when that changes. */
export function useVaultOpen(vaultId: string | null): boolean {
  const s = vaultSessions();
  return useSyncExternalStore(
    (cb) => s.subscribe(cb),
    () => (vaultId ? s.isOpen(vaultId) : false),
    () => false,
  );
}

/** Reports what only this device sees (a reveal, a copy, a preview) to the Vault's log; counts as use. */
export function useRecordEvent(vaultId: string) {
  const record = useMutation(api.vaultLog.record);
  return useCallback(
    (event: VaultDeviceEvent, item?: { id: string; kind: string }, detail?: Record<string, string | number | boolean>) => {
      if (!DEVICE_EVENTS_FOR_UI.includes(event)) return;
      vaultSessions().touch(vaultId);
      void record({ vaultId, event, ...(item ? { itemId: item.id, itemKind: item.kind } : {}), ...(detail ? { detail } : {}), client: vaultSessions().info(vaultId) }).catch(() => undefined);
    },
    [record, vaultId],
  );
}

/** Copies a secret, logs it, and clears the clipboard 30 seconds later (if it still holds that secret). */
export async function copySecret(text: string) {
  await navigator.clipboard.writeText(text);
  setTimeout(() => {
    void navigator.clipboard
      .readText()
      .then((now) => (now === text ? navigator.clipboard.writeText("") : undefined))
      .catch(() => navigator.clipboard.writeText("").catch(() => undefined));
  }, 30_000);
}
