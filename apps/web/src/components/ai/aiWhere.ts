import { useBackendMode } from "@/lib/mode";

/**
 * Where a Foli AI request goes, in the words the AI surfaces' footers use: with an account it goes to Google;
 * in a library kept on this person's devices it runs on the device (Apple Intelligence) or with their own key.
 */
export function aiWhereText(local: boolean, what: "request" | "recording" = "request"): string {
  if (what === "recording") return local ? "The recording stays on this device or goes with your own key." : "The recording is sent to Google.";
  return local ? "Runs on this device or with your own key." : "Sent to Google.";
}

/** `aiWhereText` for the mode this page runs in. */
export function useAiWhere(what: "request" | "recording" = "request"): string {
  return aiWhereText(useBackendMode() === "local", what);
}
