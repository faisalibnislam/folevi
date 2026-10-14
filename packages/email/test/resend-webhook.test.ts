import { describe, expect, it } from "vitest";
import { parseResendWebhook, verifyResendSignature, WEBHOOK_TOLERANCE_MS } from "../src/index";

// A fake signing secret in Resend's (Svix's) format: "whsec_" + base64 key bytes.
const KEY = "c2VjcmV0LWtleS1mb3ItdGVzdHMtb25seS0xMjM0NTY="; // gitleaks:allow (fake test value)
const SECRET = `whsec_${KEY}`;
const NOW = 1_790_000_000_000;
const TS = String(Math.floor(NOW / 1000));

async function sign(id: string, timestamp: string, body: string, key = KEY): Promise<string> {
  const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

const delivered = (data: Record<string, unknown> = {}, type = "email.delivered") =>
  JSON.stringify({
    type,
    created_at: "2026-09-21T14:13:20.000Z",
    data: {
      email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
      from: "Folevi <hello@mail.folevi.com>",
      to: ["reader@example.com"],
      subject: "You were mentioned in Folevi",
      tags: { template: "mention_notification", attempt: "j57abc123def456" },
      ...data,
    },
  });

describe("verifyResendSignature", () => {
  it("accepts a correct Svix signature within the tolerance", async () => {
    const body = delivered();
    const signature = await sign("msg_1", TS, body);
    expect(await verifyResendSignature({ rawBody: body, id: "msg_1", timestamp: TS, signature, secret: SECRET, now: NOW })).toBe(true);
    // Any one of several signatures (a secret being rotated) is enough.
    expect(await verifyResendSignature({ rawBody: body, id: "msg_1", timestamp: TS, signature: `v1,bm9wZQ== ${signature}`, secret: SECRET, now: NOW })).toBe(true);
  });

  it("refuses a changed body, id or timestamp, another secret, and stale or future timestamps", async () => {
    const body = delivered();
    const signature = await sign("msg_1", TS, body);
    const base = { rawBody: body, id: "msg_1", timestamp: TS, signature, secret: SECRET, now: NOW };
    expect(await verifyResendSignature({ ...base, rawBody: body.replace("delivered", "bounced") })).toBe(false);
    expect(await verifyResendSignature({ ...base, id: "msg_2" })).toBe(false);
    expect(await verifyResendSignature({ ...base, signature: await sign("msg_1", TS, body, "b3RoZXIta2V5LW90aGVyLWtleS1vdGhlci1rZXk=") })).toBe(false);
    expect(await verifyResendSignature({ ...base, now: NOW + WEBHOOK_TOLERANCE_MS + 1000 })).toBe(false);
    expect(await verifyResendSignature({ ...base, now: NOW - WEBHOOK_TOLERANCE_MS - 1000 })).toBe(false);
  });

  it("refuses missing or malformed parts", async () => {
    const body = delivered();
    const signature = await sign("msg_1", TS, body);
    const base = { rawBody: body, id: "msg_1", timestamp: TS, signature, secret: SECRET, now: NOW };
    expect(await verifyResendSignature({ ...base, secret: undefined })).toBe(false);
    expect(await verifyResendSignature({ ...base, secret: "" })).toBe(false);
    expect(await verifyResendSignature({ ...base, id: null })).toBe(false);
    expect(await verifyResendSignature({ ...base, timestamp: "soon" })).toBe(false);
    expect(await verifyResendSignature({ ...base, signature: signature.replace("v1,", "v2,") })).toBe(false);
    expect(await verifyResendSignature({ ...base, signature: null })).toBe(false);
  });
});

describe("parseResendWebhook", () => {
  it("keeps only what Folevi stores from a delivery event", () => {
    expect(parseResendWebhook(delivered(), "msg_1", NOW)).toEqual({
      kind: "delivery",
      event: {
        eventId: "msg_1",
        eventName: "delivered",
        eventTime: Date.parse("2026-09-21T14:13:20.000Z"),
        messageId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
        recipient: "reader@example.com",
        category: "mention_notification",
        attemptId: "j57abc123def456",
      },
    });
  });

  it("names events the way the send log does", () => {
    const name = (type: string, data: Record<string, unknown> = {}) => {
      const out = parseResendWebhook(delivered(data, type), "msg_1", NOW);
      return out?.kind === "delivery" ? out.event.eventName : out?.kind;
    };
    expect(name("email.bounced", { bounce: { type: "Permanent", subType: "General", message: "550 no such user" } })).toBe("bounced");
    expect(name("email.bounced", { bounce: { type: "Transient", subType: "MailboxFull" } })).toBe("soft_bounced");
    expect(name("email.complained")).toBe("spam_complaint");
    expect(name("email.delivery_delayed")).toBe("soft_bounced");
    expect(name("email.failed")).toBe("rejected");
    expect(name("email.suppressed")).toBe("suppressed");
    expect(name("email.sent")).toBe("other");
    expect(name("contact.created")).toBe("ignored");
  });

  it("keeps the bounce type but never the SMTP text", () => {
    const out = parseResendWebhook(delivered({ bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 jane@example.com unknown" } }, "email.bounced"), "msg_1", NOW);
    expect(out).toMatchObject({ kind: "delivery", event: { bounceCategory: "Permanent:General" } });
    expect(JSON.stringify(out)).not.toContain("550");
  });

  it("reads tags sent as a list too, and drops tags that aren't ids", () => {
    const out = parseResendWebhook(delivered({ tags: [{ name: "template", value: "comment_digest" }, { name: "attempt", value: "<script>" }] }), "msg_1", NOW);
    expect(out).toMatchObject({ kind: "delivery", event: { category: "comment_digest" } });
    expect(out?.kind === "delivery" ? out.event.attemptId : "missing").toBeUndefined();
  });

  it("turns email.received into an id to fetch, with no content", () => {
    const body = JSON.stringify({ type: "email.received", created_at: "2026-09-21T14:13:20.000Z", data: { email_id: "56761188-7520-42d8-8898-ff6fc54ce618", from: "jane@example.com", to: ["support@folevi.com"], subject: "Help" } });
    expect(parseResendWebhook(body, "msg_9", NOW)).toEqual({ kind: "received", eventId: "msg_9", emailId: "56761188-7520-42d8-8898-ff6fc54ce618" });
    expect(parseResendWebhook(JSON.stringify({ type: "email.received", data: { email_id: "../x" } }), "msg_9", NOW)).toBeNull();
  });

  it("refuses bodies that aren't Resend events", () => {
    expect(parseResendWebhook("not json", "msg_1", NOW)).toBeNull();
    expect(parseResendWebhook(JSON.stringify({ type: "email.delivered" }), "msg_1", NOW)).toBeNull();
    expect(parseResendWebhook(JSON.stringify([1, 2]), "msg_1", NOW)).toBeNull();
    expect(parseResendWebhook(delivered(), "bad id!", NOW)).toBeNull();
  });
});
