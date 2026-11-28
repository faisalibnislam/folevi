/**
 * Settings search: every setting by its card title, with the everyday words people type for it ("dark mode",
 * "change my email", "cancel subscription"). Matching is local and instant: each word of the query must start a
 * word of the title, its section or its keywords, with filler words ("how", "do", "i", "my") ignored, so a
 * question finds the same thing as a keyword.
 */
export type SettingsHit = { title: string; section: string; words: string };

export const SETTINGS_INDEX: SettingsHit[] = [
  { section: "account", title: "Profile", words: "name photo picture avatar email address time zone timezone" },
  { section: "account", title: "Delete account", words: "remove close account erase data leave folevi" },
  { section: "ai", title: "How Foli AI works for you", words: "assistant ai turn off on disable enable chat" },
  { section: "ai", title: "Memory", words: "memories remember forget ai" },
  { section: "ai", title: "Routines", words: "automation schedule recurring ai" },
  { section: "ai", title: "Digest", words: "summary weekly daily brief email ai" },
  { section: "ai", title: "Usage", words: "credits limit quota ai" },
  { section: "ai", title: "Conversations", words: "chats history ai" },
  { section: "ai", title: "Search in images", words: "ocr text photos pictures" },
  { section: "ai", title: "Your own AI key", words: "api key openai anthropic byok" },
  { section: "billing", title: "Your plan", words: "subscription pro upgrade downgrade cancel price pay" },
  { section: "billing", title: "AI credits", words: "buy credits top up" },
  { section: "billing", title: "Storage", words: "space quota full files attachments" },
  { section: "billing", title: "Billing history", words: "invoices receipts payments" },
  { section: "security", title: "Password", words: "change reset password" },
  { section: "security", title: "Passkeys", words: "face id touch id fingerprint sign in" },
  { section: "security", title: "Two-step verification", words: "2fa mfa authenticator backup codes" },
  { section: "security", title: "Sign-in methods", words: "google apple login" },
  { section: "privacy", title: "End-to-end encryption", words: "encrypt private secure e2ee" },
  { section: "devices", title: "Signed in", words: "sessions sign out log out everywhere" },
  { section: "devices", title: "Connected devices", words: "phone computer mac iphone" },
  { section: "connected-apps", title: "Connected apps", words: "integrations zapier mcp claude chatgpt" },
  { section: "connected-apps", title: "Personal access tokens", words: "api token developer" },
  { section: "connected-apps", title: "Webhooks", words: "developer api events" },
  { section: "connected-apps", title: "Email to Folevi", words: "forward email inbox send to note" },
  { section: "appearance", title: "Theme", words: "dark mode light mode night colours colors look" },
  { section: "appearance", title: "Editor text size", words: "font size bigger smaller zoom" },
  { section: "appearance", title: "Note lists", words: "layout cards list columns view" },
  { section: "writing", title: "Spelling and prediction", words: "spell check autocorrect suggestions typing" },
  { section: "writing", title: "Your dictionary", words: "words spelling add word" },
  { section: "writing", title: "Ignored words", words: "spelling ignore" },
  { section: "notifications", title: "Notifications", words: "alerts reminders mentions push" },
  { section: "notifications", title: "Email delivery", words: "emails unsubscribe" },
  { section: "notifications", title: "Muted notes", words: "mute silence unmute" },
  { section: "sync", title: "This device", words: "offline sync download cache clear local data" },
  { section: "library", title: "Where your library is", words: "location folder move local" },
  { section: "library", title: "Passphrase", words: "encrypt lock password local" },
  { section: "library", title: "App lock", words: "lock face id touch id" },
  { section: "data", title: "Import & export", words: "backup download export import markdown evernote notion apple notes" },
  { section: "desktop", title: "Quick Add", words: "shortcut hotkey menu bar mac" },
  { section: "desktop", title: "Folevi for Mac", words: "launch at login dock app" },
  { section: "this-device", title: "Lock", words: "face id passcode iphone ipad" },
  { section: "workspace", title: "Workspace", words: "team name rename leave delete workspace" },
  { section: "members", title: "Invite people", words: "invite add members team share" },
  { section: "members", title: "Members", words: "people roles admin remove team" },
  { section: "workspace-guests", title: "Guests", words: "outside people share" },
  { section: "workspace-billing", title: "Workspace plan", words: "team subscription seats billing" },
];

const FILLER = new Set(["a", "an", "the", "how", "do", "i", "can", "to", "my", "me", "where", "is", "of", "in", "on", "for", "what", "turn", "set", "change", "find", "make", "want"]);

/** The query's words, lower-case, without filler (kept when the query is nothing but filler). */
function terms(q: string): string[] {
  const all = q.toLowerCase().split(/[^a-z0-9&-]+/).filter(Boolean);
  const kept = all.filter((w) => !FILLER.has(w));
  return kept.length ? kept : all;
}

/** The settings that match, best first: title matches before keyword-only ones. */
export function searchSettings(query: string, sectionLabel: (id: string) => string | undefined, index = SETTINGS_INDEX): SettingsHit[] {
  const t = terms(query);
  if (!t.length) return [];
  const scored: { hit: SettingsHit; score: number }[] = [];
  for (const hit of index) {
    const label = sectionLabel(hit.section);
    if (label === undefined) continue; // a section this person doesn't have
    const title = hit.title.toLowerCase().split(/[^a-z0-9&-]+/);
    const all = [...title, ...label.toLowerCase().split(/[^a-z0-9&-]+/), ...hit.words.split(" ")];
    if (!t.every((w) => all.some((x) => x.startsWith(w)))) continue;
    const inTitle = t.filter((w) => title.some((x) => x.startsWith(w))).length;
    scored.push({ hit, score: inTitle });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.hit);
}
