// Foli AI in the showcase: the app's own local Foli AI (lib/local/ai: the prompts, search over the notes, the
// streaming answer with its sources) on a stand-in model that writes a known answer, since a page on the web has
// no model and no key. It plays the part of the host's bridge (configureLocalAiHost), as a person's own key
// would. It answers the questions the showcase asks; anything else gets a short, honest line.
import type { AiCaps, AiRequest, AiResult, ShellAi } from "@/lib/shell/types";
import { configureLocalAiHost, refreshLocalAi } from "@/lib/local/ai/state";

/** The question the Foli AI chapter asks. */
export const SHOWCASE_QUESTION = "What's left before the launch?";

/** The number a note has in the answering prompt ("[2] Launch week"), for its citation. */
function cite(prompt: string, title: string): string {
  const m = new RegExp(`^\\[(\\d{1,2})\\] ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").exec(prompt);
  return m ? ` [${m[1]}]` : "";
}

function reply(req: AiRequest): string {
  const prompt = req.messages.map((m) => m.content).join("\n");
  const system = req.system ?? "";
  if (system.includes("full-text search queries")) return JSON.stringify({ queries: ["launch", "press kit", "pricing page", "launch post"], act: false });
  if (system.includes("You name conversations")) return "Before the launch";
  if (prompt.includes("Question:") && /launch/i.test(prompt)) {
    const week = cite(prompt, "Launch week");
    const spring = cite(prompt, "Spring launch");
    const plan = cite(prompt, "Content plan");
    return [
      `Three things are left before Thursday${week}:`,
      "",
      "- **Send the press kit**, due today.",
      "- **Review the launch post** with Sam, due tomorrow.",
      "- **Publish the pricing page**, due in two days.",
      "",
      `The embargo lifts at 9am on the 12th, when Sam schedules the launch post${spring}${plan}.`,
      "[[follow-ups]]",
      "Draft the press kit email",
      "What's due after the launch?",
    ].join("\n");
  }
  return "This is a demo of Foli AI, and it only knows a few questions about the Studio launch.";
}

const CAPS: AiCaps = { onDevice: false, keys: { "ai.anthropic": true } };

const host: ShellAi = {
  capabilities: async () => CAPS,
  generate(req, onChunk) {
    const text = reply(req);
    let cancelled = false;
    const done = new Promise<AiResult>((resolve) => {
      // Plumbing calls (JSON, titles) answer at once; the answer streams in a few words at a time.
      if (req.messages.some((m) => m.content.includes("Question:")) && !req.json) {
        const words = text.split(/(?<=\s)/);
        let at = 0;
        let soFar = "";
        const step = () => {
          if (cancelled) return resolve({ text: soFar, stopReason: "cancelled" });
          const next = words.slice(at, at + 2).join("");
          at += 2;
          soFar += next;
          onChunk(next);
          if (at >= words.length) resolve({ text, stopReason: "end" });
          else setTimeout(step, 45);
        };
        setTimeout(step, 350);
      } else {
        onChunk(text);
        resolve({ text, stopReason: "end" });
      }
    });
    return { done, cancel: () => void (cancelled = true) };
  },
};

export function startShowcaseAi(): void {
  configureLocalAiHost(() => ({ ai: host, secrets: null }));
  void refreshLocalAi();
}
