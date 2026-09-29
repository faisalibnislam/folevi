import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseLoopsWebhook, verifyLoopsWebhook } from "../src/index";

const KEY = randomBytes(32);
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW_MS = 1_790_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));
const ID = "msg_2abcDEF";

const BODY = JSON.stringify({
  eventName: "email.delivered",
  eventTime: 1790000000,
  webhookSchemaVersion: "1.0.0",
  sourceType: "transactional",
  transactionalId: "cltemplate123",
  contactIdentity: { id: "c1", email: "reader@example.com", userId: null },
  email: { id: "em_1", emailMessageId: "<x@loops>", subject: "You were mentioned in Folevi" },
});

function sign(body: string, key: Buffer = KEY, id = ID, ts = TS): string {
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

describe("verifyLoopsWebhook", () => {
  it("accepts a valid signature", async () => {
    expect(
      await verifyLoopsWebhook({
        id: ID,
        timestamp: TS,
        signature: sign(BODY),
        rawBody: BODY,
        secret: SECRET,
        now: NOW_MS,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const tampered = BODY.replace("delivered", "hardBounced");
    expect(
      await verifyLoopsWebhook({
        id: ID,
        timestamp: TS,
        signature: sign(BODY),
        rawBody: tampered,
        secret: SECRET,
        now: NOW_MS,
      }),
    ).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const other = `whsec_${randomBytes(32).toString("base64")}`;
    expect(
      await verifyLoopsWebhook({
        id: ID,
        timestamp: TS,
        signature: sign(BODY),
        rawBody: BODY,
        secret: other,
        now: NOW_MS,
      }),
    ).toBe(false);
  });

  it("rejects stale and future timestamps (±5 min)", async () => {
    const stale = String(Number(TS) - 301);
    expect(
      await verifyLoopsWebhook({
        id: ID,
        timestamp: stale,
        signature: sign(BODY, KEY, ID, stale),
        rawBody: BODY,
        secret: SECRET,
        now: NOW_MS,
      }),
    ).toBe(false);
    const future = String(Number(TS) + 301);
    expect(
      await verifyLoopsWebhook({
        id: ID,
        timestamp: future,
        signature: sign(BODY, KEY, ID, future),
        rawBody: BODY,
        secret: SECRET,
        now: NOW_MS,
      }),
    ).toBe(false);
    const edge = String(Number(TS) - 299);
    expect(
      await verifyLoopsWebhook({
        id: ID,
        timestamp: edge,
        signature: sign(BODY, KEY, ID, edge),
        rawBody: BODY,
        secret: SECRET,
        now: NOW_MS,
      }),
    ).toBe(true);
  });

  it("accepts when any of multiple signatures matches (secret rotation)", async () => {
    const oldKey = randomBytes(32);
    const header = `${sign(BODY, oldKey)} v2,bogus ${sign(BODY)}`;
    expect(
      await verifyLoopsWebhook({
        id: ID,
        timestamp: TS,
        signature: header,
        rawBody: BODY,
        secret: SECRET,
        now: NOW_MS,
      }),
    ).toBe(true);
    const onlyWrong = `${sign(BODY, oldKey)} v1,${"A".repeat(44)}`;
    expect(
      await verifyLoopsWebhook({
        id: ID,
        timestamp: TS,
        signature: onlyWrong,
        rawBody: BODY,
        secret: SECRET,
        now: NOW_MS,
      }),
    ).toBe(false);
  });

  it("rejects missing headers, a different id, and non-v1 schemes", async () => {
    const base = { rawBody: BODY, secret: SECRET, now: NOW_MS };
    expect(
      await verifyLoopsWebhook({ ...base, id: null, timestamp: TS, signature: sign(BODY) }),
    ).toBe(false);
    expect(
      await verifyLoopsWebhook({ ...base, id: ID, timestamp: null, signature: sign(BODY) }),
    ).toBe(false);
    expect(await verifyLoopsWebhook({ ...base, id: ID, timestamp: TS, signature: null })).toBe(
      false,
    );
    expect(
      await verifyLoopsWebhook({ ...base, id: "msg_other", timestamp: TS, signature: sign(BODY) }),
    ).toBe(false);
    expect(
      await verifyLoopsWebhook({
        ...base,
        id: ID,
        timestamp: TS,
        signature: sign(BODY).replace("v1,", "v0,"),
      }),
    ).toBe(false);
    expect(
      await verifyLoopsWebhook({ ...base, id: ID, timestamp: "12abc", signature: sign(BODY) }),
    ).toBe(false);
    expect(
      await verifyLoopsWebhook({
        ...base,
        id: ID,
        timestamp: TS,
        signature: sign(BODY),
        secret: "whsec_!!!",
      }),
    ).toBe(false);
  });
});

describe("parseLoopsWebhook", () => {
  it("extracts only the stored fields", () => {
    expect(parseLoopsWebhook(BODY)).toEqual({
      eventName: "email.delivered",
      eventTime: 1790000000,
      transactionalId: "cltemplate123",
      emailId: "em_1",
      recipient: "reader@example.com",
    });
  });

  it("returns null for malformed input", () => {
    expect(parseLoopsWebhook("not json")).toBeNull();
    expect(parseLoopsWebhook("[]")).toBeNull();
    expect(parseLoopsWebhook(JSON.stringify({ eventName: "x" }))).toBeNull();
    expect(parseLoopsWebhook(JSON.stringify({ eventName: "", eventTime: 1 }))).toBeNull();
  });

  it("tolerates missing optional fields", () => {
    expect(
      parseLoopsWebhook(JSON.stringify({ eventName: "email.hardBounced", eventTime: 5 })),
    ).toEqual({
      eventName: "email.hardBounced",
      eventTime: 5,
    });
  });
});
