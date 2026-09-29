// Support requests: shared rules for convex/support.ts (topics, limits, text cleaning, ticket numbers).
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fail } from "./errors";

/** Topics people can pick on the support page and in the app. */
export const FORM_TOPICS = ["account", "billing", "sync", "sharing", "bug", "feedback", "other"] as const;
/** All topics: email to security@folevi.com is filed as "security" (the forms point security reports there). */
export const SUPPORT_TOPICS = [...FORM_TOPICS, "security"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const TOPIC_LABELS: Record<SupportTopic, string> = {
  account: "Account and sign-in",
  billing: "Billing and plans",
  sync: "Sync and offline",
  sharing: "Sharing and workspaces",
  bug: "Something isn't working",
  feedback: "Feedback or an idea",
  other: "Something else",
  security: "Security",
};

export const SOURCE_LABELS: Record<Doc<"supportTickets">["source"], string> = {
  web_form: "Support page",
  in_app: "In the app",
  email: "Email",
};

export const SUPPORT_LIMITS = {
  name: 80,
  email: 254,
  messageMin: 10,
  message: 5000,
  reply: 10000,
  subject: 120,
} as const;

/** The mailboxes whose mail becomes tickets (see docs/SUPPORT.md). Everything else at folevi.com is ignored. */
export const SUPPORT_MAILBOX = "support@folevi.com";
export const SECURITY_MAILBOX = "security@folevi.com";
export const SUPPORT_DOMAIN = "folevi.com";

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return value.length <= SUPPORT_LIMITS.email && EMAIL_RE.test(value);
}

export function isFormTopic(value: string): value is (typeof FORM_TOPICS)[number] {
  return (FORM_TOPICS as readonly string[]).includes(value);
}

export function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic as SupportTopic] ?? TOPIC_LABELS.other;
}

/** Plain text as people typed it: newlines kept (CRLF → LF), other control characters dropped, trimmed. */
export function cleanText(value: string, max: number): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max);
}

/** A single line: whitespace collapsed, control characters dropped. */
export function cleanLine(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** The subject of a request from a form: the first line of the message, shortened. */
export function subjectFrom(message: string): string {
  const first = message.split("\n").find((l) => l.trim()) ?? "";
  const line = cleanLine(first, 200);
  return line.length > SUPPORT_LIMITS.subject - 1 ? `${line.slice(0, SUPPORT_LIMITS.subject - 1).trimEnd()}…` : line || "Support request";
}

/** Validates a request from the support page or the app. Errors name the field, never echo the value. */
export function validateRequest(input: { name: string; email: string; topic: string; message: string }): { name: string; email: string; topic: SupportTopic; message: string } {
  const name = cleanLine(input.name, SUPPORT_LIMITS.name + 1);
  if (!name) fail("invalid_argument", "Enter your name.", { field: "name" });
  if (name.length > SUPPORT_LIMITS.name) fail("invalid_argument", `Keep your name under ${SUPPORT_LIMITS.name} characters.`, { field: "name" });
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) fail("invalid_argument", "Enter an email address we can reply to.", { field: "email" });
  if (!isFormTopic(input.topic)) fail("invalid_argument", "Choose a topic.", { field: "topic" });
  const message = cleanText(input.message, SUPPORT_LIMITS.message + 1);
  if (message.length < SUPPORT_LIMITS.messageMin) fail("invalid_argument", "Tell us a little more (at least a sentence).", { field: "message" });
  if (message.length > SUPPORT_LIMITS.message) fail("invalid_argument", `Keep your message under ${SUPPORT_LIMITS.message} characters.`, { field: "message" });
  return { name, email, topic: input.topic, message };
}

const COUNTER_KEY = "support_ticket_counter";
/** The first ticket is #1001. */
const FIRST_NUMBER = 1001;

/**
 * The next ticket number. Reading and writing the counter row inside the mutation makes Convex serialize
 * concurrent submissions, so numbers are unique and in order.
 */
export async function nextTicketNumber(ctx: MutationCtx): Promise<number> {
  const row = await ctx.db
    .query("systemSettings")
    .withIndex("by_key", (q) => q.eq("key", COUNTER_KEY))
    .unique();
  const current = typeof row?.value === "number" ? row.value : FIRST_NUMBER - 1;
  const next = current + 1;
  if (row) await ctx.db.patch(row._id, { value: next, updatedAt: Date.now() });
  else await ctx.db.insert("systemSettings", { key: COUNTER_KEY, value: next, updatedAt: Date.now() });
  return next;
}
