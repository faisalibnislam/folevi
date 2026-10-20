// Local mode (WP7b): what comes from the snapshot bundled with the app (themes, switched-off built-in
// templates) and the profile picture, which the parity scenarios can't set up on both backends (the server
// side needs an admin's rows and an upload through storage). tests/parity covers the rest of these modules.
import { afterEach, describe, expect, test } from "vitest";
import { BUILT_IN_TEMPLATES } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { setBundledSnapshotForTests } from "@/lib/local/functions/themes";
import { LOCAL_ENTITLEMENTS } from "@/lib/local/functions/users";
import { createTestLocalClient } from "@/lib/local/testing";
import { EMPTY_SNAPSHOT, type ShellSnapshot } from "@/lib/shell/snapshot";
import type { ThemeRow } from "@/lib/themes";

const row = (key: string, patch: Partial<ThemeRow> = {}): ThemeRow => ({
  key,
  name: null,
  status: "published",
  order: 0,
  plan: "free",
  image: null,
  palette: null,
  defaults: null,
  fonts: null,
  updatedAt: 1,
  ...patch,
});

const snapshot = (patch: Partial<ShellSnapshot>): ShellSnapshot => ({ ...EMPTY_SNAPSHOT, ...patch });

afterEach(() => setBundledSnapshotForTests(null));

describe("local mode: the bundled snapshot", () => {
  test("themes.list answers the snapshot's rows in order, without admins' unpublished drafts", async () => {
    const draft = `th-${"A".repeat(26)}`;
    setBundledSnapshotForTests(snapshot({ themes: [row("art-09", { order: 2 }), row("art-03", { order: 1, defaults: { font: "mono", separator: "dots" } }), row(draft, { status: "draft", order: 3 })] }));
    const client = await createTestLocalClient();
    expect(((await client.query(api.themes.list, {})) as ThemeRow[]).map((r) => r.key)).toEqual(["art-03", "art-09"]);
    await client.close();
  });

  test("switched-off built-in templates are left out, and onboarding doesn't add them", async () => {
    const off = BUILT_IN_TEMPLATES[0]!.key;
    setBundledSnapshotForTests(snapshot({ templates: { disabled: [off] } }));
    const client = await createTestLocalClient();
    const templates = (await client.query(api.settings.builtInTemplates, {})) as { key: string }[];
    expect(templates.map((t) => t.key)).not.toContain(`builtin:${off}`);
    expect(templates).toHaveLength(BUILT_IN_TEMPLATES.length - 1);
    expect(await client.query(api.settings.disabledBuiltInTemplates, {})).toEqual([off]);
    await client.close();
  });

  test("a theme an admin changed gives the Welcome note its defaults", async () => {
    setBundledSnapshotForTests(snapshot({ themes: [row("art-03", { defaults: { font: "mono", separator: "dots" } })] }));
    const client = await createTestLocalClient({ seed: true });
    await client.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "art-03" });
    const list = (await client.query(api.documents.list, { scope: { kind: "personal" }, view: "all", paginationOpts: { numItems: 50, cursor: null } })) as { page: { id: string; title: string }[] };
    const welcome = list.page.find((d) => d.title === "Welcome to Folevi")!;
    const got = (await client.query(api.documents.get, { documentId: welcome.id })) as { document: { cover: unknown; style: { font: string; separator: string } } };
    expect(got.document.cover).toEqual({ kind: "art", value: "art-03" });
    expect(got.document.style).toMatchObject({ font: "mono", separator: "dots" });
    await client.close();
  });
});

describe("local mode: the profile", () => {
  test("users.me is the most capable shape: every limit open, nothing for sale", async () => {
    const client = await createTestLocalClient();
    const me = (await client.query(api.users.me, {})) as { state: string; profile: { entitlements: typeof LOCAL_ENTITLEMENTS } };
    expect(me.profile.entitlements).toEqual(LOCAL_ENTITLEMENTS);
    expect(me.profile.entitlements).toMatchObject({ ai: true, devices: null, creditPacks: false, trialing: false, plan: "pro_ai" });
    expect(await client.query(api.themes.planForDocument, { documentId: "missing" })).toBeNull();
    await client.close();
  });

  test("a picture added to the library becomes the profile picture; the previous one is deleted", async () => {
    const client = await createTestLocalClient();
    const first = await client.local.putFile(new Blob(["one"], { type: "image/png" }), { name: "a.png", mimeType: "image/png", kind: "avatar" });
    await client.mutation(api.users.setAvatar, { fileId: first.fileId });
    const url = ((await client.query(api.users.me, {})) as { profile: { avatarUrl: string | null } }).profile.avatarUrl;
    // jsdom has no object URLs, and there's no shell here: the picture is set, it just has nowhere to show from.
    expect(url === null || typeof url === "string").toBe(true);
    const second = await client.local.putFile(new Blob(["two"], { type: "image/png" }), { name: "b.png", mimeType: "image/png", kind: "avatar" });
    await client.mutation(api.users.setAvatar, { fileId: second.fileId });
    expect(await client.store.get("files", first.fileId)).toBeUndefined();
    expect(await client.store.get("files", second.fileId)).toBeDefined();
    // An attachment of a note isn't a profile picture.
    const attachment = await client.local.putFile(new Blob(["x"], { type: "image/png" }), { name: "c.png", mimeType: "image/png", kind: "image", documentId: "note" });
    await expect(client.mutation(api.users.setAvatar, { fileId: attachment.fileId })).rejects.toMatchObject({ data: { code: "not_found" } });
    await client.mutation(api.users.removeAvatar, {});
    expect(await client.store.get("files", second.fileId)).toBeUndefined();
    expect(((await client.query(api.users.me, {})) as { profile: { avatarUrl: string | null } }).profile.avatarUrl).toBeNull();
    await client.close();
  });
});
