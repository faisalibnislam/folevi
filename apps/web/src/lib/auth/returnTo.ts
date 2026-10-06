/** Only same-site relative paths are allowed as post-auth destinations (no open redirects). */
export function safeReturnTo(value: string | null | undefined, fallback = "/documents"): string {
  // Browsers drop tabs and line breaks inside a URL, so "/\t/evil.com" would become "//evil.com": anything
  // carrying control characters is refused outright rather than cleaned.
  if (!value || /[\u0000-\u001F\u007F]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/^\/(signin|signup|two-factor|forgot-password|reset-password|verify-email)/.test(value)) return fallback;
  return value;
}
