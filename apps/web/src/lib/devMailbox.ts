import "server-only";
import { internalConvexUrl } from "@/lib/runtime/internal";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";
import { devPagesAvailable } from "@/lib/edition";

/** Local development/preview only: never available on a production deployment, nor on a Folevi server. */
export function devMailboxAvailable(): boolean {
  return devPagesAvailable() && Boolean(process.env.FOLEVI_DEV_MAILBOX_SECRET);
}

export async function readDevMailbox(to?: string) {
  const url = internalConvexUrl();
  const secret = process.env.FOLEVI_DEV_MAILBOX_SECRET;
  if (!devMailboxAvailable() || !url || !secret) return null;
  const client = new ConvexHttpClient(url);
  return await client.query(api.authEmails.devMailbox, { to, secret });
}
