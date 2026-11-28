// Settings search with Foli AI (the owner, 28 November 2026): when a person describes what they want in their own
// words ("stop the emails about comments", "make the text easier to read"), Foli AI picks the settings that do it
// from the list the app sends (each setting's id, title and section) and says in one sentence what to change. It
// only ever names settings from that list; the app shows them as rows that open the setting.
import { PERSONA } from "./ask";
import type { PromptRequest } from "./request";

/** One setting the app offers: its id, its card title and the section it's in. */
export type SettingOption = { key: string; title: string; section: string };

/** At most this many settings in a request, and this long a question. */
export const SETTINGS_SEARCH_MAX_OPTIONS = 120;
export const SETTINGS_SEARCH_MAX_QUERY = 200;

export function settingsSearchRequest(o: { query: string; options: SettingOption[] }): PromptRequest {
  const list = o.options.map((s) => `${s.key} | ${s.section} > ${s.title}`).join("\n");
  return {
    system: `${PERSONA} You help someone find the right setting in Folevi's Settings. You only choose from the settings listed; you never invent one.`,
    prompt: `<settings>\n${list}\n</settings>\n\n<question>\n${o.query.replace(/[<>]/g, " ").slice(0, SETTINGS_SEARCH_MAX_QUERY)}\n</question>\n\nReply with JSON only: {"keys": [...], "answer": "..."}. "keys": the ids (the text before " | ") of up to 3 settings that do what the question asks, best first; [] when none does. "answer": one plain sentence (under 25 words) saying where to go and what to change, naming the section and setting as written in the list; when none fits, say so plainly. No Markdown.`,
    fast: true,
    json: true,
    temperature: 0.1,
    maxOutputTokens: 200,
  };
}

/** Reads a settingsSearchRequest reply: only ids from the list, at most 3, and the sentence. */
export function parseSettingsSearch(answer: string, known: ReadonlySet<string>): { keys: string[]; answer: string } {
  let raw: unknown;
  try {
    const start = answer.indexOf("{");
    const end = answer.lastIndexOf("}");
    raw = JSON.parse(start >= 0 && end > start ? answer.slice(start, end + 1) : answer);
  } catch {
    return { keys: [], answer: "" };
  }
  const obj = (raw ?? {}) as { keys?: unknown; answer?: unknown };
  const keys = Array.isArray(obj.keys) ? [...new Set(obj.keys.filter((k): k is string => typeof k === "string" && known.has(k)))].slice(0, 3) : [];
  const text = typeof obj.answer === "string" ? obj.answer.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 240) : "";
  return { keys, answer: text };
}
