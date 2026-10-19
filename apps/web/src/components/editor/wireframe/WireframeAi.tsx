"use client";

// Foli AI for a wireframe: draw a new screen (or a short flow) from a description, make variations of the
// selected screen, or refine it. The server (convex/wireframeAi.ts) returns screens already checked; the
// canvas checks them again, places them and applies them as one change (⌘Z undoes it). AI credits are
// charged like any Foli AI request.
import { useState } from "react";
import { useAction } from "convex/react";
import { ArrowUp, X } from "lucide-react";
import { WIREFRAME_FRAMES, WIREFRAME_FRAME_LABEL, type WireframeData, type WireframeFrame } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AiIcon } from "@/components/ai/AiIcon";
import { useNoteAi } from "@/components/ai/useAi";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { FRAME_ICON } from "./WireframeChrome";

export type AiMode = "draw" | "vary" | "refine";

const IDEAS: Record<AiMode, string[]> = {
  draw: ["A sign-up screen with a Google button", "A settings screen with toggles for notifications", "A checkout flow: cart, shipping, payment"],
  vary: ["Try a card layout", "Make it simpler", "Put the main action at the bottom"],
  refine: ["Add a forgot password link", "Add a bottom tab bar", "Make the main button stand out more"],
};

export function WireframeAi({
  mode: initial,
  screen,
  screenName,
  onResult,
  onClose,
}: {
  mode: AiMode;
  /** The selected screen and its parts as wireframe JSON (variations and refine work on it), or null. */
  screen: (() => string) | null;
  screenName: string | null;
  onResult: (mode: AiMode, wf: WireframeData) => void;
  onClose: () => void;
}) {
  const { scope } = useAppState();
  const documentId = useNoteAi()?.home?.id;
  const draw = useAction(api.wireframeAi.draw);
  const vary = useAction(api.wireframeAi.vary);
  const refine = useAction(api.wireframeAi.refine);
  const [mode, setMode] = useState<AiMode>(screen ? initial : "draw");
  const [frame, setFrame] = useState<WireframeFrame>("phone");
  const [count, setCount] = useState(3);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiProblem | null>(null);

  const run = async (instruction: string) => {
    if (busy) return;
    const what = instruction.trim();
    if (mode !== "vary" && !what) return;
    setBusy(true);
    setError(null);
    try {
      const place = { scope, ...(documentId ? { documentId } : {}) };
      const wf =
        mode === "draw"
          ? await draw({ ...place, instruction: what, frame })
          : mode === "vary"
            ? await vary({ ...place, screen: screen!(), count, ...(what ? { instruction: what } : {}) })
            : await refine({ ...place, screen: screen!(), instruction: what });
      onResult(mode, wf as WireframeData);
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setBusy(false);
    }
  };

  const label = mode === "draw" ? "Draw a screen with Foli AI" : mode === "vary" ? "Make variations with Foli AI" : "Refine the screen with Foli AI";
  const placeholder = mode === "draw" ? "Describe a screen, e.g. a sign-up screen with a Google button" : mode === "vary" ? "Anything to try? (optional)" : "What should change? e.g. add a forgot password link";
  return (
    <div
      className="wf-ai ui-pop"
      role="dialog"
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="wf-ai-modes" role="group" aria-label="What Foli AI should do">
        <button type="button" aria-pressed={mode === "draw"} onClick={() => setMode("draw")}>
          New screen
        </button>
        <button type="button" aria-pressed={mode === "vary"} disabled={!screen} onClick={() => setMode("vary")} title={screen ? undefined : "Select a screen first"}>
          Variations
        </button>
        <button type="button" aria-pressed={mode === "refine"} disabled={!screen} onClick={() => setMode("refine")} title={screen ? undefined : "Select a screen first"}>
          Refine
        </button>
        <span className="fb-vc-spacer" aria-hidden />
        <button type="button" className="fb-vc-btn" aria-label="Close Foli AI" title="Close (Esc)" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>
      {mode !== "draw" && screenName ? <p className="wf-ai-about">On “{screenName}”</p> : null}
      {mode === "draw" ? (
        <div className="wf-ai-options">
          <span className="wf-seg" role="group" aria-label="Frame">
            {WIREFRAME_FRAMES.filter((f) => f !== "plain").map((f) => (
              <button key={f} type="button" aria-pressed={frame === f} onClick={() => setFrame(f)}>
                {FRAME_ICON[f]} {WIREFRAME_FRAME_LABEL[f]}
              </button>
            ))}
          </span>
        </div>
      ) : mode === "vary" ? (
        <div className="wf-ai-options">
          <span className="wf-seg" role="group" aria-label="How many">
            {[2, 3].map((n) => (
              <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)}>
                {n} variations
              </button>
            ))}
          </span>
        </div>
      ) : null}
      <form
        className="wf-ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
      >
        <AiIcon size={15} className="wf-ai-mark flex-none" />
        <textarea
          autoFocus
          rows={2}
          value={text}
          disabled={busy}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run(text);
            }
          }}
          aria-label={label}
          placeholder={placeholder}
        />
        <button type="submit" className="wf-ai-send" aria-label={mode === "draw" ? "Draw" : mode === "vary" ? "Make variations" : "Refine"} disabled={busy || (mode !== "vary" && !text.trim())}>
          <ArrowUp size={15} aria-hidden />
        </button>
      </form>
      {busy ? (
        <p className="wf-ai-status" role="status">
          {mode === "draw" ? "Drawing the screen…" : mode === "vary" ? "Making variations…" : "Refining the screen…"}
        </p>
      ) : error ? (
        <AiProblemNotice problem={error} className={error.kind === "other" ? "wf-ai-error" : "mx-3 mb-2"} />
      ) : (
        <>
          <AiCreditsNote documentId={documentId} className="mx-3 mb-2" />
          <ul className="wf-ai-ideas" aria-label="Ideas">
            {IDEAS[mode].map((idea) => (
              <li key={idea}>
                <button type="button" onClick={() => setText(idea)}>
                  {idea}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="wf-ai-foot">Foli AI can make mistakes. Sent to Google Gemini. Undo with ⌘Z.</p>
    </div>
  );
}
