// Onboarding: the step order, starter pages from use cases, the Welcome page's style, appearance and the
// AI setting, input validation, idempotence and the older clients' arguments.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { BUILT_IN_TEMPLATES } from "../../convex/lib/templates";
import { ONBOARDING_NOTE_STYLES, USE_CASES, starterPagesFor } from "../../convex/lib/onboarding";
import { WELCOME_TITLE } from "../../convex/lib/seedContent";
import { person, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function profileOf(p: Person) {
  const me = await p.as.query(api.users.me, {});
  if (me.state !== "ready") throw new Error(me.state);
  return me.profile;
}

async function personalDocs(t: T, p: Person): Promise<Doc<"documents">[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("documents").collect()).filter((d) => d.ownerProfileId === p.profileId && d.kind === "document" && !d.inTrash),
  );
}

async function welcome(t: T, p: Person) {
  return (await personalDocs(t, p)).find((d) => d.title === WELCOME_TITLE)!;
}

describe("shared onboarding data", () => {
  test("every starter page is a real built-in template with the same name and icon", () => {
    for (const useCase of USE_CASES) {
      expect(useCase.pages.length).toBeGreaterThan(0);
      for (const page of useCase.pages) {
        const template = BUILT_IN_TEMPLATES.find((t) => t.key === page.template);
        expect(template, page.template).toBeDefined();
        expect(page.title).toBe(template!.name);
        expect(page.icon).toBe(template!.icon);
      }
    }
  });

  test("a template shared by two use cases is listed once", () => {
    const pages = starterPagesFor(["work", "team"]).map((p) => p.template);
    expect(pages).toEqual(["project-brief", "meeting-notes", "retrospective"]);
  });
});

describe("completeOnboardingStep", () => {
  test("walks every step in order and applies each choice", async () => {
    const t = setup();
    const a = await person(t, "onboard-walk@example.com");
    expect((await profileOf(a)).onboardingStep).toBe("workspace");
    const before = (await personalDocs(t, a)).length;

    await a.as.mutation(api.users.completeOnboardingStep, { step: "workspace" });
    expect((await profileOf(a)).onboardingStep).toBe("uses");

    await a.as.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["work", "travel"] });
    const me = await profileOf(a);
    expect(me.onboardingStep).toBe("style");
    expect(me.onboardingUseCases).toEqual(["work", "travel"]);
    const docs = await personalDocs(t, a);
    expect(docs.length).toBe(before + 4);
    const added = docs.filter((d) => d.templateKey?.startsWith("builtin:"));
    expect(added.map((d) => d.title).sort()).toEqual(["Event Plan", "Meeting Notes", "Project Brief", "Travel Plan"]);
    // New notes start Plain, and a starter page has the template's content.
    for (const d of added) expect(d.cover).toEqual({ kind: "none" });
    expect(added.every((d) => d.blockCount > 0)).toBe(true);

    const seqBefore = (await welcome(t, a)).seq;
    await a.as.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "art-03" });
    const styled = await welcome(t, a);
    expect(styled.cover).toEqual({ kind: "art", value: "art-03" });
    expect(styled.seq).toBeGreaterThan(seqBefore);
    expect((await profileOf(a)).onboardingStep).toBe("appearance");

    await a.as.mutation(api.users.completeOnboardingStep, { step: "appearance", appearance: "dark" });
    expect((await profileOf(a)).appearance).toBe("dark");
    expect((await profileOf(a)).onboardingStep).toBe("ai");

    expect((await profileOf(a)).aiEnabled).toBe(true);
    await a.as.mutation(api.users.completeOnboardingStep, { step: "ai", aiEnabled: false });
    expect((await profileOf(a)).aiEnabled).toBe(false);
    expect((await profileOf(a)).onboardingStep).toBe("welcome");

    await a.as.mutation(api.users.completeOnboardingStep, { step: "welcome" });
    expect((await profileOf(a)).onboardingStep).toBe("done");
  });

  test("skipping leaves everything as it was", async () => {
    const t = setup();
    const a = await person(t, "onboard-skip@example.com");
    const before = await personalDocs(t, a);
    for (const step of ["workspace", "uses", "style", "appearance", "ai"] as const) await a.as.mutation(api.users.completeOnboardingStep, { step });
    const me = await profileOf(a);
    expect(me.onboardingStep).toBe("welcome");
    expect(me.appearance).toBe("system");
    expect(me.aiEnabled).toBe(true);
    expect(me.onboardingUseCases).toEqual([]);
    expect((await personalDocs(t, a)).length).toBe(before.length);
    expect((await welcome(t, a)).cover).toEqual({ kind: "none" });
  });

  test("calling a step twice adds each starter page once; a new pick adds only its own pages", async () => {
    const t = setup();
    const a = await person(t, "onboard-twice@example.com");
    const before = (await personalDocs(t, a)).length;
    await a.as.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["work"] });
    await a.as.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["work", "work"] });
    expect((await personalDocs(t, a)).length).toBe(before + 2);
    // "team" shares Meeting Notes with "work": only the Retrospective is new.
    await a.as.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["team"] });
    const docs = await personalDocs(t, a);
    expect(docs.length).toBe(before + 3);
    expect(docs.filter((d) => d.title === "Meeting Notes")).toHaveLength(1);
    expect((await profileOf(a)).onboardingUseCases).toEqual(["work", "team"]);
    // Styling twice (and back to Plain) only touches the Welcome page.
    await a.as.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "art-39" });
    await a.as.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "art-39" });
    expect((await welcome(t, a)).cover).toEqual({ kind: "art", value: "art-39" });
    await a.as.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "plain" });
    expect((await welcome(t, a)).cover).toEqual({ kind: "none" });
  });

  test("progress never moves back", async () => {
    const t = setup();
    const a = await person(t, "onboard-forward@example.com");
    await a.as.mutation(api.users.completeOnboardingStep, { step: "ai" });
    await a.as.mutation(api.users.completeOnboardingStep, { step: "workspace" });
    expect((await profileOf(a)).onboardingStep).toBe("welcome");
    await a.as.mutation(api.users.completeOnboardingStep, { step: "welcome" });
    await a.as.mutation(api.users.completeOnboardingStep, { step: "uses" });
    expect((await profileOf(a)).onboardingStep).toBe("done");
  });

  test("rejects unknown or misplaced choices", async () => {
    const t = setup();
    const a = await person(t, "onboard-invalid@example.com");
    const before = (await personalDocs(t, a)).length;
    const bad = [
      { step: "uses" as const, useCases: ["work", "crypto"] },
      { step: "uses" as const, useCases: [...USE_CASES.map((u) => u.id), "work"] },
      { step: "style" as const, noteStyle: "art-02" },
      { step: "style" as const, noteStyle: "javascript:alert(1)" },
      { step: "style" as const, useCases: ["work"] },
      { step: "uses" as const, noteStyle: "art-03" },
      { step: "workspace" as const, aiEnabled: false },
      { step: "ai" as const, appearance: "dark" as const },
    ];
    for (const args of bad) await expect(a.as.mutation(api.users.completeOnboardingStep, args)).rejects.toThrow();
    const me = await profileOf(a);
    expect(me.onboardingStep).toBe("workspace");
    expect(me.onboardingUseCases).toEqual([]);
    expect((await personalDocs(t, a)).length).toBe(before);
    expect((await welcome(t, a)).cover).toEqual({ kind: "none" });
    expect(ONBOARDING_NOTE_STYLES).not.toContain("art-02");
  });

  test("a disabled built-in template is skipped", async () => {
    const t = setup();
    const a = await person(t, "onboard-disabled@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("builtInTemplates", { key: "travel-plan", name: "Travel Plan", description: "x", icon: "plane", enabled: false, rank: "V", updatedAt: Date.now() });
    });
    const before = (await personalDocs(t, a)).length;
    await a.as.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["travel"] });
    const docs = await personalDocs(t, a);
    expect(docs.length).toBe(before + 1);
    expect(docs.some((d) => d.title === "Travel Plan" && d.templateKey)).toBe(false);
  });

  test("the older three-step arguments still work", async () => {
    const t = setup();
    const a = await person(t, "onboard-legacy@example.com");
    await a.as.mutation(api.users.completeOnboardingStep, { step: "workspace", workspaceName: "My space" });
    await a.as.mutation(api.users.completeOnboardingStep, { step: "appearance", appearance: "light" });
    const mid = await profileOf(a);
    expect(mid.appearance).toBe("light");
    expect(mid.onboardingStep).toBe("ai");
    await a.as.mutation(api.users.completeOnboardingStep, { step: "welcome" });
    expect((await profileOf(a)).onboardingStep).toBe("done");
    expect(await a.as.query(api.workspaces.mine, {})).toEqual([]);
  });

  test("the Welcome page is only styled if it's still the person's own", async () => {
    const t = setup();
    const a = await person(t, "onboard-gone@example.com");
    const w = await welcome(t, a);
    await t.run(async (ctx) => {
      await ctx.db.patch(w._id, { inTrash: true });
    });
    await a.as.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "art-03" });
    expect((await t.run(async (ctx) => await ctx.db.get(w._id)))!.cover).toEqual({ kind: "none" });
    expect((await profileOf(a)).onboardingStep).toBe("appearance");
  });
});
