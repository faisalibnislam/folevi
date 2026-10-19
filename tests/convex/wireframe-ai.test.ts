// Foli AI for wireframes (convex/wireframeAi.ts): the model's JSON is checked before it's returned, and the
// usual gates apply (AI off, credits).
import { describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { serializeWireframe, wireframeDataIssue } from "@folevi/editor-schema";
import { person, setup } from "./helpers";

const SCREEN = JSON.stringify({
  v: 1,
  screens: [{ id: "s1", name: "Sign in", frame: "phone", x: 0, y: 0, w: 390, h: 844 }],
  items: [{ id: "i1", screen: "s1", kind: "button", x: 16, y: 700, w: 358, h: 48, text: "Sign in" }],
});

function reply(screens: number) {
  return {
    screens: Array.from({ length: screens }, (_, i) => ({ name: `Screen ${i + 1}`, frame: "phone", parts: [{ kind: "heading", text: `Hello ${i}` }, { kind: "button", text: "Go", onclick: "x" }] })),
  };
}

describe("Foli AI wireframes", () => {
  test("draw, vary and refine return checked wireframes; bad requests and AI off are refused", async () => {
    const t = setup();
    const a = await person(t, "ai-wireframe@example.com");
    process.env.GEMINI_API_KEY = "test-key";
    const prompts: string[] = [];
    let screens = 1;
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      prompts.push(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply(screens)) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 600 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const drawn = await a.as.action(api.wireframeAi.draw, { scope: a.scope, instruction: "a sign-up screen with a Google button", frame: "tablet" });
      expect(wireframeDataIssue(serializeWireframe(drawn))).toBeNull();
      expect(drawn.screens).toHaveLength(1);
      expect(drawn.screens[0]!.frame).toBe("phone");
      expect(drawn.items.map((i) => i.kind)).toEqual(["heading", "button"]);
      expect(JSON.stringify(drawn)).not.toContain("onclick");
      expect(prompts[0]).toContain("tablet screen");

      screens = 5;
      const varied = await a.as.action(api.wireframeAi.vary, { scope: a.scope, screen: SCREEN, count: 9 });
      expect(varied.screens).toHaveLength(3);
      expect(prompts[1]).toContain("Make 3 different variations");
      expect(prompts[1]).toContain("Sign in");

      screens = 1;
      const refined = await a.as.action(api.wireframeAi.refine, { scope: a.scope, screen: SCREEN, instruction: "add a forgot password link" });
      expect(refined.screens).toHaveLength(1);
      expect(prompts[2]).toContain("forgot password");

      await expect(a.as.action(api.wireframeAi.draw, { scope: a.scope, instruction: "   " })).rejects.toThrow(/Describe the screen/);
      await expect(a.as.action(api.wireframeAi.refine, { scope: a.scope, screen: SCREEN, instruction: "" })).rejects.toThrow(/Say what to change/);
      await expect(a.as.action(api.wireframeAi.vary, { scope: a.scope, screen: "" })).rejects.toThrow(/Pick a screen/);

      // Nothing usable back: a plain refusal.
      fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sorry." }] }, finishReason: "STOP" }] }), { status: 200 }));
      await expect(a.as.action(api.wireframeAi.draw, { scope: a.scope, instruction: "anything" })).rejects.toThrow(/couldn't draw/);

      // Turned off in settings: refused before anything is sent.
      await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
      const calls = fetchMock.mock.calls.length;
      await expect(a.as.action(api.wireframeAi.draw, { scope: a.scope, instruction: "a sign-up screen" })).rejects.toThrow(/turned off/);
      expect(fetchMock.mock.calls.length).toBe(calls);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GEMINI_API_KEY;
    }
  });
});
