/** Only same-site relative paths are allowed as post-auth destinations (no open redirects). */
export function safeReturnTo(value: string | null | undefined, fallback = "/documents"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/^\/(signin|signup|two-factor|forgot-password|reset-password|verify-email)/.test(value)) return fallback;
  return value;
}
