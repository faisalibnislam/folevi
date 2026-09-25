import { describe, expect, it } from "vitest";
import {
  emailManifest,
  hashRecipient,
  redactEmail,
  transactionalIdFor,
  validateDataVariables,
} from "../src/index";

const mention = () => ({ ...emailManifest.mention_notification.fixture });

function errorsOf(result: ReturnType<typeof validateDataVariables>): string[] {
  return result.ok ? [] : result.errors;
}

describe("validateDataVariables", () => {
  it("accepts the fixture and fills optional variables with empty strings", () => {
    const vars = mention();
    delete (vars as Record<string, unknown>).excerpt;
    const result = validateDataVariables("mention_notification", vars);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dataVariables.excerpt).toBe("");
  });

  it("rejects unknown variables", () => {
    const result = validateDataVariables("mention_notification", {
      ...mention(),
      noteBody: "secret",
    });
    expect(errorsOf(result).join()).toMatch(/noteBody: unknown variable/);
  });

  it("is case-sensitive about names", () => {
    const vars: Record<string, unknown> = mention();
    vars.DocumentUrl = vars.documentUrl;
    delete vars.documentUrl;
    const errors = errorsOf(validateDataVariables("mention_notification", vars)).join("\n");
    expect(errors).toMatch(
      /DocumentUrl: unknown variable \(names are case-sensitive; did you mean "documentUrl"\?\)/,
    );
    expect(errors).toMatch(/documentUrl: missing required variable/);
  });

  it("rejects booleans and null", () => {
    expect(
      errorsOf(validateDataVariables("mention_notification", { ...mention(), excerpt: true })),
    ).toEqual(["excerpt: booleans are not allowed"]);
    expect(
      errorsOf(validateDataVariables("mention_notification", { ...mention(), excerpt: null })),
    ).toEqual(["excerpt: null is not allowed"]);
  });

  it("rejects wrong types", () => {
    const r1 = validateDataVariables("auth_verify_email", {
      actionUrl: "https://auth.folevi.com/u/email-verification?ticket=x",
      expiresInHours: "24",
    });
    expect(errorsOf(r1)).toEqual(["expiresInHours: must be a finite number"]);
    const r2 = validateDataVariables("auth_verify_email", {
      actionUrl: 42,
      expiresInHours: Number.NaN,
    });
    expect(errorsOf(r2)).toEqual([
      "actionUrl: must be a string",
      "expiresInHours: must be a finite number",
    ]);
  });

  it("enforces maxLength after trimming (code points)", () => {
    const ok = validateDataVariables("mention_notification", {
      ...mention(),
      documentTitle: `  ${"é".repeat(120)}  `,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.dataVariables.documentTitle).toBe("é".repeat(120));
    const tooLong = validateDataVariables("mention_notification", {
      ...mention(),
      excerpt: "x".repeat(141),
    });
    expect(errorsOf(tooLong)).toEqual(["excerpt: exceeds maxLength 140"]);
  });

  it("rejects an empty required string", () => {
    const r = validateDataVariables("mention_notification", { ...mention(), actorName: "   " });
    expect(errorsOf(r)).toEqual(["actorName: required variable is empty"]);
  });

  it.each([
    ["http://app.folevi.com/d/1", false],
    ["javascript:alert(1)", false],
    ["ftp://example.com/x", false],
    ["https://user:pw@app.folevi.com/", false],
    ["not a url", false],
    ["https://app.folevi.com/d/1", true],
    ["http://localhost:3000/d/1", true],
    ["http://app.localhost:3000/d/1", true],
  ])("url format: %s → %s", (value, ok) => {
    const r = validateDataVariables("mention_notification", { ...mention(), documentUrl: value });
    expect(r.ok).toBe(ok);
  });

  it("serialises URLs so they cannot break out of an href", () => {
    const r = validateDataVariables("mention_notification", {
      ...mention(),
      documentUrl: 'https://app.folevi.com/d/1"onmouseover="x',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.dataVariables.documentUrl)).not.toContain('"');
  });

  it("neutralises markup in user-controlled text", () => {
    const r = validateDataVariables("mention_notification", {
      ...mention(),
      documentTitle: '<a href="https://evil.example">Win</a>',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataVariables.documentTitle).toBe('‹a href="https://evil.example"›Win‹/a›');
  });

  it("rejects control characters", () => {
    const r = validateDataVariables("mention_notification", {
      ...mention(),
      actorName: "Maya\u0007",
    });
    expect(errorsOf(r)).toEqual(["actorName: contains control characters"]);
  });

  it("validates code format", () => {
    expect(
      validateDataVariables("auth_verification_code", { code: "12 34", expiresInMinutes: 10 }).ok,
    ).toBe(false);
    expect(
      validateDataVariables("auth_verification_code", { code: "123456", expiresInMinutes: 10 }).ok,
    ).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(
      validateDataVariables("mention_notification", [] as unknown as Record<string, unknown>).ok,
    ).toBe(false);
  });
});

describe("transactionalIdFor", () => {
  it("reads the manifest env var and rejects blank/garbage values", () => {
    const envVar = emailManifest.auth_verify_email.envVar;
    expect(transactionalIdFor("auth_verify_email", { [envVar]: " clabc123xyz " })).toBe(
      "clabc123xyz",
    );
    expect(transactionalIdFor("auth_verify_email", { [envVar]: "" })).toBeNull();
    expect(transactionalIdFor("auth_verify_email", { [envVar]: "has space" })).toBeNull();
    expect(transactionalIdFor("auth_verify_email", {})).toBeNull();
  });
});

describe("privacy helpers", () => {
  it("redacts emails", () => {
    expect(redactEmail("jane.doe@example.com")).toBe("j***@e***.com");
    expect(redactEmail("x@mail.folevi.co.uk")).toBe("x***@m***.uk");
    expect(redactEmail("nonsense")).toBe("***");
    expect(redactEmail("@example.com")).toBe("***");
  });

  it("hashes recipients case-insensitively with a salt", async () => {
    const a = await hashRecipient("Jane@Example.com", "salt");
    const b = await hashRecipient(" jane@example.com ", "salt");
    const c = await hashRecipient("jane@example.com", "other");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
