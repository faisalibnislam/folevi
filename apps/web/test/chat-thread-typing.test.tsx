import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Typing in Foli AI's chat box draws the box again, not the conversation above it (ChatThread's ThreadMessages,
// docs/WEB_PERFORMANCE.md). The messages are stood in for, counting how often they're drawn.
const drawn = vi.hoisted(() => ({ user: 0, assistant: 0 }));
const conversation = vi.hoisted(() => ({
  conversation: { id: "c1", title: "Trip", scope: { kind: "personal" }, context: { kind: "workspace", items: [] } },
  messages: [
    { id: "m1", role: "user", text: "When is the ferry?" },
    { id: "m2", role: "assistant", text: "Friday [1].", status: "done", citations: [], webCitations: [] },
  ],
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : ref === "get" ? conversation : undefined),
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useConvex: () => ({}),
}));
vi.mock("@/lib/convex/api", () => ({ api: new Proxy({}, { get: (_t, mod) => new Proxy({}, { get: (_u, fn) => (mod === "aiChat" && fn === "get" ? "get" : `${String(mod)}.${String(fn)}`) }) }) }));
vi.mock("@/lib/app/state", () => ({ useAppState: () => ({ scope: { kind: "personal" }, profile: null }) }));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate: vi.fn() }) }));
vi.mock("@/lib/iphone", () => ({ useIphoneApp: () => false }));
vi.mock("@/components/ai/useAi", () => ({ useAiAccess: () => ({ on: true, context: "personal" }) }));
vi.mock("@/components/ai/AiCredits", () => ({ AiCreditsNote: () => null, AiProblemNotice: () => null, aiProblem: (e: unknown) => e, useAiCredits: () => null }));
vi.mock("@/components/ai/chat/mode", () => ({ useChatMode: () => ["ask", vi.fn()] }));
vi.mock("@/components/ai/chat/ContextChips", () => ({ ContextChips: () => null }));
vi.mock("@/components/ai/chat/ChatMessage", () => ({
  UserMessage: ({ text }: { text: string }) => {
    drawn.user++;
    return <p>{text}</p>;
  },
  AssistantMessage: ({ message }: { message: { text: string } }) => {
    drawn.assistant++;
    return <p>{message.text}</p>;
  },
}));

describe("ChatThread while typing", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("each letter typed leaves the messages as they were drawn", async () => {
    Element.prototype.scrollIntoView = () => undefined;
    const { ChatThread } = await import("@/components/ai/chat/ChatThread");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<ChatThread conversationId="c1" onConversation={() => undefined} variant="floating" />));
    expect(host.textContent).toContain("When is the ferry?");
    expect(host.textContent).toContain("Friday [1].");
    const before = { ...drawn };
    const box = host.querySelector("textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    for (const text of ["A", "An", "And", "And Sat"]) {
      act(() => {
        setValue.call(box, text);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(box.value).toBe("And Sat");
    expect(drawn).toEqual(before);
    act(() => root.unmount());
  });
});
