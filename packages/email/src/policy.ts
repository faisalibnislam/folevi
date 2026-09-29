import type { SendPolicy } from "./types";

const TEST_DOMAINS = new Set(["example.com", "test.com"]);

/** Non-production: only @example.com, @test.com, or exact allowlisted addresses. */
export function isRecipientAllowed(email: string, policy: SendPolicy): boolean {
  if (policy.environment === "production") return true;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (TEST_DOMAINS.has(domain)) return true;
  return (policy.allowlist ?? []).some((a) => a.trim().toLowerCase() === normalized);
}
