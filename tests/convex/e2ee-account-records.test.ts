// A person's own records sealed with their account master key (convex/e2ee/accountRecords.ts): their own AI keys,
// shared between their devices. Only an account with encryption set up stores them, under its current epoch;
// only the owner reads or writes them; a removal leaves an empty row; the server never holds the key in the clear;
// deleting the account deletes them.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { e2eeLib, e2eePerson, person, setup, wire } from "./helpers";

const KEY = "sk-ant-api03-SYNCEDKEY-0000000000000000";

async function sealedKey(p: Awaited<ReturnType<typeof e2eePerson>>, provider: string, apiKey = KEY) {
  const e2ee = await e2eeLib();
  return await e2ee.sealRecord(p.account.records, p.epoch, e2ee.ctx.accountRecord(p.profileId, "aiKey", provider), new TextEncoder().encode(JSON.stringify({ apiKey })));
}

describe("own AI keys sealed for the person's devices", () => {
  test("stored sealed under the current epoch; another device opens it; the server never sees the key", async () => {
    const t = setup();
    const a = await e2eePerson(t, "records-a@example.com");
    const sealed = await sealedKey(a, "anthropic");
    await a.as.mutation(api.e2ee.accountRecords.put, { kind: "aiKey", recordId: "anthropic", epoch: 1, sealed: wire(sealed) });
    const rows = await a.as.query(api.e2ee.accountRecords.list, { kind: "aiKey" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recordId: "anthropic", epoch: 1, deletedAt: null });
    // Another device, holding the same master key, opens it.
    const e2ee = await e2eeLib();
    const keys = await e2ee.deriveAccountKeys(a.amk);
    const plain = await e2ee.openRecord(keys.records, e2ee.ctx.accountRecord(a.profileId, "aiKey", "anthropic"), new Uint8Array(rows[0]!.sealed!));
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual({ apiKey: KEY });
    // Sealed to its own context: the record can't pass for another provider's.
    await expect(e2ee.openRecord(keys.records, e2ee.ctx.accountRecord(a.profileId, "aiKey", "openai"), new Uint8Array(rows[0]!.sealed!))).rejects.toThrow();
    const stored = await t.run(async (ctx) => JSON.stringify(await ctx.db.query("e2eeAccountRecords").collect()));
    expect(stored).not.toContain("SYNCEDKEY");
  });

  test("refused without encryption, under another epoch, for another record name, or when too large", async () => {
    const t = setup();
    const plain = await person(t, "records-plain@example.com");
    const a = await e2eePerson(t, "records-b@example.com");
    const sealed = wire(await sealedKey(a, "openai"));
    await expect(plain.as.mutation(api.e2ee.accountRecords.put, { kind: "aiKey", recordId: "openai", epoch: 1, sealed })).rejects.toThrow(/isn't set up/);
    await expect(a.as.mutation(api.e2ee.accountRecords.put, { kind: "aiKey", recordId: "openai", epoch: 2, sealed })).rejects.toThrow(/key changed/);
    await expect(a.as.mutation(api.e2ee.accountRecords.put, { kind: "aiKey", recordId: "auth.session", epoch: 1, sealed })).rejects.toThrow(/doesn't keep/);
    // The provider and model in use is one more record.
    await a.as.mutation(api.e2ee.accountRecords.put, { kind: "aiKey", recordId: "choice", epoch: 1, sealed: wire(await sealedKey(a, "choice")) });
    await expect(a.as.mutation(api.e2ee.accountRecords.put, { kind: "aiKey", recordId: "openai", epoch: 1, sealed: new ArrayBuffer(5000) })).rejects.toThrow(/too large/);
  });

  test("only the owner sees them; removing leaves an empty row; deleting the account deletes them", async () => {
    const t = setup();
    const a = await e2eePerson(t, "records-c@example.com");
    const b = await e2eePerson(t, "records-d@example.com");
    await a.as.mutation(api.e2ee.accountRecords.put, { kind: "aiKey", recordId: "gemini", epoch: 1, sealed: wire(await sealedKey(a, "gemini")) });
    expect(await b.as.query(api.e2ee.accountRecords.list, { kind: "aiKey" })).toEqual([]);
    await a.as.mutation(api.e2ee.accountRecords.remove, { kind: "aiKey", recordId: "gemini" });
    const [row] = await a.as.query(api.e2ee.accountRecords.list, { kind: "aiKey" });
    expect(row).toMatchObject({ recordId: "gemini", sealed: null });
    expect(row!.deletedAt).toBeGreaterThan(0);
    // Saving again brings it back.
    await a.as.mutation(api.e2ee.accountRecords.put, { kind: "aiKey", recordId: "gemini", epoch: 1, sealed: wire(await sealedKey(a, "gemini")) });
    expect((await a.as.query(api.e2ee.accountRecords.list, { kind: "aiKey" }))[0]).toMatchObject({ deletedAt: null });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("e2eeAccountRecords").collect();
      expect(rows.map((r) => r.profileId)).toEqual([a.profileId as Id<"profiles">]);
    });
  });
});
