import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";

/** Local development/preview only: never available on a production deployment. */
export function devMailboxAvailable(): boolean {
  return process.env.VERCEL_ENV !== "production" && process.env.FOLEVI_ENV !== "production" && Boolean(process.env.FOLEVI_DEV_MAILBOX_SECRET);
}

export async function readDevMailbox(to?: string) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.FOLEVI_DEV_MAILBOX_SECRET;
  if (!devMailboxAvailable() || !url || !secret) return null;
  const client = new ConvexHttpClient(url);
  return await client.query(api.authEmails.devMailbox, { to, secret });
}
