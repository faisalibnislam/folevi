import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_MAILTRAP_EVENTS, normaliseMailtrapEventName, parseMailtrapWebhook, verifyMailtrapSignature } from "../src/index";

const SECRET = "mailtrap-signing-secret-0123456789"; // gitleaks:allow (fake test value)
const event = (overrides: Record<string, unknown> = {}) => ({
  event: "delivery",
  message_id: "1d7a4a6e-0000-4000-8000-00000000abcd",
  email: "reader@example.com",
  timestamp: 1790000000,
  event_id: "b3f6a1c2-1111-4222-8333-444455556666",
  sending_stream: "transactional",
  sending_domain_name: "mail.folevi.com",
  category: "mention_notification",
  custom_variables: { attempt: "j57abc123def456", template: "mention_notification" },
  ip: "203.0.113.9",
  user_agent: "Mozilla/5.0",
  ...overrides,
});
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");

describe("verifyMailtrapSignature", () => {
  const body = JSON.stringify({ events: [event()] });

  it("accepts the hex HMAC-SHA256 of the raw body (either case)", async () => {
    expect(await verifyMailtrapSignature({ rawBody: body, signature: sign(body), secret: SECRET })).toBe(true);
    expect(await verifyMailtrapSignature({ rawBody: body, signature: sign(body).toUpperCase(), secret: SECRET })).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, a missing or malformed signature, and an empty secret", async () => {
    expect(await verifyMailtrapSignature({ rawBody: body.replace("delivery", "bounce"), signature: sign(body), secret: SECRET })).toBe(false);
    expect(await verifyMailtrapSignature({ rawBody: body, signature: sign(body, "other"), secret: SECRET })).toBe(false);
    expect(await verifyMailtrapSignature({ rawBody: body, signature: null, secret: SECRET })).toBe(false);
    expect(await verifyMailtrapSignature({ rawBody: body, signature: "", secret: SECRET })).toBe(false);
    expect(await verifyMailtrapSignature({ rawBody: body, signature: "sha256=" + sign(body), secret: SECRET })).toBe(false);
    expect(await verifyMailtrapSignature({ rawBody: body, signature: sign(body).slice(0, 63), secret: SECRET })).toBe(false);
    expect(await verifyMailtrapSignature({ rawBody: body, signature: sign(body, ""), secret: "" })).toBe(false);
    expect(await verifyMailtrapSignature({ rawBody: body, signature: sign(body), secret: undefined })).toBe(false);
  });

  it("signs the raw bytes, not a re-serialisation", async () => {
    const spaced = `{ "events": [ ${JSON.stringify(event())} ] }`;
    expect(await verifyMailtrapSignature({ rawBody: spaced, signature: sign(spaced), secret: SECRET })).toBe(true);
    expect(await verifyMailtrapSignature({ rawBody: spaced, signature: sign(JSON.stringify(JSON.parse(spaced))), secret: SECRET })).toBe(false);
  });
});

describe("parseMailtrapWebhook", () => {
  it("parses {events: [...]} and keeps only the stored fields", () => {
    const parsed = parseMailtrapWebhook(JSON.stringify({ events: [event(), event({ event: "soft bounce", event_id: "e2", bounce_category: "mailbox_full", response_code: 452, response: "452 4.2.2 <reader@example.com> mailbox full", reason: "x" })] }));
    expect(parsed).not.toBeNull();
    expect(parsed!.ignored).toBe(0);
    expect(parsed!.events[0]).toEqual({
      eventId: "b3f6a1c2-1111-4222-8333-444455556666",
      eventName: "delivered",
      eventTime: 1790000000000,
      messageId: "1d7a4a6e-0000-4000-8000-00000000abcd",
      recipient: "reader@example.com",
      category: "mention_notification",
      attemptId: "j57abc123def456",
    });
    expect(parsed!.events[1]).toMatchObject({ eventId: "e2", eventName: "soft_bounced", bounceCategory: "mailbox_full", responseCode: 452 });
    // SMTP text, IPs and user agents are never kept.
    const json = JSON.stringify(parsed);
    for (const dropped of ["203.0.113.9", "Mozilla", "mailbox full", "452 4.2.2"]) expect(json).not.toContain(dropped);
  });

  it("parses JSON Lines (single events or batches per line)", () => {
    const body = [JSON.stringify(event({ event_id: "a" })), "", JSON.stringify({ events: [event({ event_id: "b", event: "bounce" })] })].join("\n");
    const parsed = parseMailtrapWebhook(body);
    expect(parsed!.events.map((e) => [e.eventId, e.eventName])).toEqual([["a", "delivered"], ["b", "bounced"]]);
  });

  it("skips events that can't be deduplicated, and rejects malformed or oversized bodies", () => {
    expect(parseMailtrapWebhook(JSON.stringify({ events: [event({ event_id: undefined }), event()] }))).toMatchObject({ ignored: 1 });
    expect(parseMailtrapWebhook("")).toBeNull();
    expect(parseMailtrapWebhook("not json\n{also not")).toBeNull();
    expect(parseMailtrapWebhook("42")).toBeNull();
    const many = { events: Array.from({ length: MAX_MAILTRAP_EVENTS + 1 }, (_, i) => event({ event_id: `e${i}` })) };
    expect(parseMailtrapWebhook(JSON.stringify(many))).toBeNull();
  });

  it("ignores custom variables that aren't opaque attempt ids", () => {
    const parsed = parseMailtrapWebhook(JSON.stringify({ events: [event({ custom_variables: { attempt: "x; drop table" } })] }));
    expect(parsed!.events[0]).not.toHaveProperty("attemptId");
  });

  it("normalises every Mailtrap event name", () => {
    expect(["delivery", "soft bounce", "bounce", "suspension", "unsubscribe", "open", "click", "spam", "spam complaint", "reject", "weird"].map(normaliseMailtrapEventName)).toEqual([
      "delivered",
      "soft_bounced",
      "bounced",
      "suspended",
      "unsubscribed",
      "opened",
      "clicked",
      "spam_complaint",
      "spam_complaint",
      "rejected",
      "other",
    ]);
  });
});
