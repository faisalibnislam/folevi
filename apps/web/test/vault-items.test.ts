// The Vault's password items on the device (lib/vault: items, totp, generator, importExport) with real keys.
import { describe, expect, test } from "vitest";
import { deriveVaultKeys, newVaultKey } from "@folevi/local-store/e2ee";
import { changedFields, newItemId, openSecrets, openSummary, sealItem, splitItem } from "@/lib/vault/items";
import { base32Decode, parseTotp, totpCode } from "@/lib/vault/totp";
import { passphrase, passwordStrength, randomPassword } from "@/lib/vault/generator";
import { detectSource, encryptedExport, itemsFromCsv, itemsToCsv, openEncryptedExport, parseCsv } from "@/lib/vault/importExport";

describe("vault items", () => {
  test("an item seals into a summary and secrets that only the vault key opens, each in its own place", async () => {
    const keys = await deriveVaultKeys(newVaultKey());
    const other = await deriveVaultKeys(newVaultKey());
    const id = newItemId();
    const content = splitItem("login", "Bank", { username: "sam", password: "s3cret!", website: "https://bank.example", totp: "JBSWY3DPEHPK3PXP" }, "PIN in the drawer");
    expect(content.summary.fields).toEqual({ username: "sam", website: "https://bank.example" });
    expect(content.secrets.fields).toEqual({ password: "s3cret!", totp: "JBSWY3DPEHPK3PXP" });
    const sealed = await sealItem("v1", id, 1, keys, content);
    expect(sealed.passwordMac).toMatch(/^[\w-]{22}$/);
    const row = { id, ...sealed };
    expect(await openSummary("v1", row, () => keys)).toMatchObject({ kind: "login", title: "Bank", fields: { username: "sam" } });
    expect(await openSecrets("v1", row, () => keys)).toEqual(content.secrets);
    // Another Vault's key, another item id, or the summary in the secrets' place: none opens.
    await expect(openSecrets("v1", row, () => other)).rejects.toThrow();
    await expect(openSecrets("v1", { ...row, id: newItemId() }, () => keys)).rejects.toThrow();
    await expect(openSecrets("v1", { ...row, sealed: row.sealedSummary }, () => keys)).rejects.toThrow();
    // The same password gives the same blind index in one Vault, a different one in another.
    const again = await sealItem("v1", newItemId(), 1, keys, splitItem("login", "Other", { password: "s3cret!" }));
    expect(again.passwordMac).toBe(sealed.passwordMac);
    expect((await sealItem("v2", newItemId(), 1, other, splitItem("login", "Other", { password: "s3cret!" }))).passwordMac).not.toBe(sealed.passwordMac);
  });

  test("changed fields are named, never their values", () => {
    const a = splitItem("login", "Bank", { username: "sam", password: "one" });
    const b = splitItem("login", "Bank", { username: "sam", password: "two", website: "https://x.example" }, "note");
    expect(changedFields(a, b)).toEqual(["notes", "password", "website"]);
  });
});

describe("2FA codes", () => {
  test("RFC 6238's test vectors (SHA-1, SHA-256, SHA-512, 8 digits)", async () => {
    const ascii = (s: string) => new TextEncoder().encode(s);
    const sha1 = { secret: ascii("12345678901234567890"), algorithm: "SHA-1" as const, digits: 8, period: 30 };
    const sha256 = { secret: ascii("12345678901234567890123456789012"), algorithm: "SHA-256" as const, digits: 8, period: 30 };
    const sha512 = { secret: ascii("1234567890123456789012345678901234567890123456789012345678901234"), algorithm: "SHA-512" as const, digits: 8, period: 30 };
    expect((await totpCode(sha1, 59_000)).code).toBe("94287082");
    expect((await totpCode(sha256, 59_000)).code).toBe("46119246");
    expect((await totpCode(sha512, 59_000)).code).toBe("90693936");
    expect((await totpCode(sha1, 1111111109_000)).code).toBe("07081804");
    expect((await totpCode(sha1, 20000000000_000)).code).toBe("65353130");
    expect((await totpCode(sha1, 59_000)).secondsLeft).toBe(1);
  });

  test("secrets and otpauth links", () => {
    expect(Array.from(base32Decode("MZXW6===")!)).toEqual([102, 111, 111]);
    expect(base32Decode("not base32!")).toBeNull();
    expect(parseTotp("JBSWY3DPEHPK3PXP")).toMatchObject({ algorithm: "SHA-1", digits: 6, period: 30 });
    expect(parseTotp("otpauth://totp/Acme:sam?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60")).toMatchObject({ algorithm: "SHA-256", digits: 8, period: 60 });
    expect(parseTotp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4")).toBeNull();
    expect(parseTotp("hello")).toBeNull();
  });
});

describe("making passwords", () => {
  test("random passwords have what was asked for and nothing that looks alike", () => {
    for (let i = 0; i < 50; i++) {
      const p = randomPassword({ length: 16, digits: true, symbols: true });
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[^a-zA-Z\d]/);
      expect(p).not.toMatch(/[lIO01]/);
    }
    expect(randomPassword({ length: 12, digits: false, symbols: false })).toMatch(/^[a-zA-Z]{12}$/);
    expect(new Set(Array.from({ length: 20 }, () => randomPassword())).size).toBe(20);
  });

  test("passphrases and strength", () => {
    const p = passphrase(5);
    expect(p.split("-")).toHaveLength(5);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/\d$/);
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("password123").score).toBeLessThanOrEqual(1);
    expect(passwordStrength("aaaaaa").score).toBe(0);
    expect(passwordStrength(randomPassword()).score).toBe(4);
    expect(passwordStrength(passphrase(5)).score).toBe(4);
  });
});

describe("import and export", () => {
  test("CSV: quotes, doubled quotes, newlines in fields, a byte order mark", () => {
    expect(parseCsv('﻿a,b\n"x, y","he said ""hi"""\n"two\nlines",z\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["two\nlines", "z"],
    ]);
  });

  test("each app's export is recognised and read", () => {
    const cases: [string, string][] = [
      ["1Password", "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nBank,https://bank.example,sam,pw1,,false,false,Money,PIN in drawer"],
      ["Bitwarden", "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nMoney,,login,Bank,PIN in drawer,,0,https://bank.example,sam,pw1,"],
      ["LastPass", "url,username,password,totp,extra,name,grouping,fav\nhttps://bank.example,sam,pw1,,PIN in drawer,Bank,Money,0"],
      ["Chrome", "name,url,username,password,note\nBank,https://bank.example,sam,pw1,PIN in drawer"],
      ["Safari", "Title,URL,Username,Password,Notes,OTPAuth\nBank,https://bank.example,sam,pw1,PIN in drawer,"],
      ["Firefox", 'url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\nhttps://bank.example,sam,pw1,,"",{1},1,1,1'],
    ];
    for (const [source, csv] of cases) {
      const r = itemsFromCsv(csv);
      expect(r.source, source).toBe(source);
      expect(r.items, source).toHaveLength(1);
      const item = r.items[0]!;
      expect(item.kind).toBe("login");
      expect(item.summary.fields.username).toBe("sam");
      expect(item.secrets.fields.password).toBe("pw1");
      expect(item.summary.title).toBe(source === "Firefox" ? "bank.example" : "Bank");
    }
    expect(detectSource(["anything", "else"])).toBe("CSV");
    // A LastPass secure note.
    const note = itemsFromCsv("url,username,password,totp,extra,name,grouping,fav\nhttp://sn,,,,The wifi code is 1234,Wifi,,0").items[0]!;
    expect(note.kind).toBe("secureNote");
    expect(note.secrets.fields.text).toBe("The wifi code is 1234");
  });

  test("plain CSV out, and an encrypted backup only its passphrase opens", { timeout: 30_000 }, async () => {
    const items = [splitItem("login", "Bank, main", { username: "sam", password: 'p"w' }, "line one\nline two")];
    const csv = itemsToCsv(items);
    expect(parseCsv(csv)[1]).toEqual(["Bank, main", "login", 'p"w', "sam", "line one\nline two", ""]);
    const file = await encryptedExport("v1", items, "a long export passphrase");
    expect(file).not.toContain("sam");
    expect(await openEncryptedExport(file, "a long export passphrase")).toEqual(items);
    await expect(openEncryptedExport(file, "the wrong passphrase")).rejects.toThrow();
  });
});

describe("vault files, notes and folders", () => {
  test("a file's bytes, a note and a folder name seal and open, and only in their own place", async () => {
    const { sealFile, openFile, openFileSummary, sealNote, openNote, openNoteSummary, sealFolderName, openFolderName } = await import("@/lib/vault/files");
    const { bytes } = await import("@/lib/e2ee/keys/util");
    const keys = await deriveVaultKeys(newVaultKey());
    const keysOf = () => keys;
    const id = newItemId();
    const data = new Uint8Array(200_000).map((_, i) => i % 251);
    const { ciphertext, item } = await sealFile("v1", id, 1, keys, { name: "Statement.pdf", type: "application/pdf", bytes: data });
    expect(ciphertext.length).toBeGreaterThan(data.length);
    const row = { id, ...item };
    expect(await openFileSummary("v1", row, keysOf)).toEqual({ kind: "file", title: "Statement.pdf", mime: "application/pdf", size: 200_000 });
    const opened = await openFile("v1", row, ciphertext, keysOf);
    expect(opened.name).toBe("Statement.pdf");
    expect(opened.bytes).toEqual(data);
    // The bytes under another item's id don't open.
    await expect(openFile("v1", { ...row, id: newItemId() }, ciphertext, keysOf)).rejects.toThrow();

    const note = await sealNote("v1", "N1", 1, keys, "Board minutes", { type: "doc", content: [] }, "Present: all");
    expect(await openNoteSummary("v1", { id: "N1", ...note }, keysOf)).toEqual({ kind: "note", title: "Board minutes", excerpt: "Present: all" });
    expect(await openNote("v1", { id: "N1", ...note }, keysOf)).toEqual({ doc: { type: "doc", content: [] } });

    const name = await sealFolderName("v1", "F1", 1, keys, "Contracts");
    expect(await openFolderName("v1", "F1", name, keysOf, 1)).toBe("Contracts");
    await expect(openFolderName("v1", "F2", name, keysOf, 1)).rejects.toThrow();
    void bytes;
  });
});

describe("sharing vault items", () => {
  test("a share opens with the recipient's account key; a link only with its fragment's secret", async () => {
    const { deriveAccountKeys, randomBytes } = await import("@folevi/local-store/e2ee");
    const { sealItemTo, openShared, makeLink, linkSecret, openLinkItem } = await import("@/lib/vault/shares");
    const keys = await deriveVaultKeys(newVaultKey());
    const id = newItemId();
    const content = splitItem("login", "Router", { username: "admin", password: "pw-123" });
    const row = { id, ...(await sealItem("v1", id, 1, keys, content)) };
    const them = await deriveAccountKeys(randomBytes(32));
    const wrappedKey = await sealItemTo("v1", row, keys, { profileId: "p9", x25519Pub: them.x25519.publicKey });
    const opened = await openShared<{ title: string }, { fields: Record<string, string> }>({ vaultId: "v1", id, wrappedKey, sealedSummary: row.sealedSummary, sealed: row.sealed }, { profileId: "p9", account: them.x25519 });
    expect(opened.summary.title).toBe("Router");
    expect(opened.secrets?.fields.password).toBe("pw-123");
    // Someone else's account key can't open it.
    const other = await deriveAccountKeys(randomBytes(32));
    await expect(openShared({ vaultId: "v1", id, wrappedKey, sealedSummary: row.sealedSummary }, { profileId: "p9", account: other.x25519 })).rejects.toThrow();

    const link = await makeLink("v1", row, keys, "https://app.folevi.com");
    expect(link.url).toMatch(new RegExp(`^https://app\\.folevi\\.com/vault-link/${link.linkId}#k=`));
    const secret = linkSecret(new URL(link.url).hash)!;
    const viaLink = await openLinkItem<{ title: string }, { fields: Record<string, string> }>({ vaultId: "v1", itemId: id, wrappedKey: link.wrappedKey, sealedSummary: row.sealedSummary, sealed: row.sealed }, link.linkId, secret);
    expect(viaLink.secrets?.fields.password).toBe("pw-123");
    expect(linkSecret("#nothing")).toBeNull();
    await expect(openLinkItem({ vaultId: "v1", itemId: id, wrappedKey: link.wrappedKey, sealedSummary: row.sealedSummary, sealed: row.sealed }, link.linkId, randomBytes(32))).rejects.toThrow();
  });
});
