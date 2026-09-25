/** "jane.doe@example.com" → "j***@e***.com". Safe for logs; never reversible. */
export function redactEmail(email: string): string {
  const value = typeof email === "string" ? email.trim() : "";
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const labels = domain.split(".");
  const tld = labels.length > 1 ? labels[labels.length - 1] : "";
  const first = labels[0] ?? "";
  const localPart = `${Array.from(local)[0] ?? ""}***`;
  const domainPart = `${Array.from(first)[0] ?? ""}***${tld ? `.${tld}` : ""}`;
  return `${localPart}@${domainPart}`;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hex SHA-256 of the lowercased, trimmed email + salt. For correlation without storing addresses. */
export async function hashRecipient(email: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${email.trim().toLowerCase()}${salt}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}
