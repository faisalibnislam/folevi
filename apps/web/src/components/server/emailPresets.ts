// Sending email through your own mail account (SMTP, the standard way mail programs send). Most people use one of
// these services; picking it fills in the server, port and security so they only type their address and password.

export type SmtpSecurity = "tls" | "starttls" | "none";

export interface EmailPreset {
  id: string;
  name: string;
  host: string;
  port: number;
  security: SmtpSecurity;
  /** What the password field asks for, in plain words. */
  passwordHint: string;
}

export const EMAIL_PRESETS: EmailPreset[] = [
  { id: "gmail", name: "Gmail", host: "smtp.gmail.com", port: 587, security: "starttls", passwordHint: "An app password from your Google account (Security > App passwords), not your usual password." },
  { id: "icloud", name: "iCloud Mail", host: "smtp.mail.me.com", port: 587, security: "starttls", passwordHint: "An app-specific password from account.apple.com, not your Apple Account password." },
  { id: "outlook", name: "Outlook or Microsoft 365", host: "smtp.office365.com", port: 587, security: "starttls", passwordHint: "Your account password, or an app password if you use two-step sign-in." },
  { id: "fastmail", name: "Fastmail", host: "smtp.fastmail.com", port: 465, security: "tls", passwordHint: "An app password from Fastmail's Settings > Privacy & Security." },
  { id: "other", name: "Another service", host: "", port: 587, security: "starttls", passwordHint: "The password your mail service gave you for sending mail." },
];

export function presetFor(host: string | undefined): EmailPreset {
  return EMAIL_PRESETS.find((p) => p.host && p.host === host) ?? EMAIL_PRESETS[EMAIL_PRESETS.length - 1]!;
}

export const SECURITY_NAMES: Record<SmtpSecurity, { title: string; description: string }> = {
  starttls: { title: "STARTTLS", description: "Encrypted, usually port 587" },
  tls: { title: "SSL/TLS", description: "Encrypted from the start, usually port 465" },
  none: { title: "None", description: "Not encrypted. Only for a mail server on your own network" },
};
