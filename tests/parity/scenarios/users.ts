// The person's profile: settings changed and read back, onboarding's choices (starter notes, the Welcome
// note's theme), and the profile picture. An account's profile and a library's start differently on
// purpose (an account has an email, starts onboarding and a trial; a library has neither), so each scenario
// sets what it compares.
import { WELCOME_TITLE } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { scenario } from "../types";

async function attempt<T>(p: Promise<T>): Promise<{ ok: T } | { error: unknown }> {
  try {
    return { ok: await p };
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    return { error: typeof data === "string" ? JSON.parse(data) : (data ?? String(e)) };
  }
}

export const scenarios = [
  scenario({
    name: "profile: settings changed and read back",
    async run(b) {
      await b.mutation(api.users.updateProfile, {
        displayName: "  Robin <Gardener>\u0007 ",
        appearance: "dark",
        aiEnabled: true,
        aiPrefs: { memory: false, digests: true },
        timeZone: "Europe/Lisbon",
        notificationPrefs: { mentions: false, comments: true, shares: false, invites: true, digest: "daily", productEmail: false },
        reviewAppEdits: true,
      });
      const first = await b.query(api.users.me, {});
      // Only what's given changes.
      await b.mutation(api.users.updateProfile, { aiPrefs: { readImages: true }, appearance: "light" });
      const emptyName = await attempt(b.mutation(api.users.updateProfile, { displayName: " <> " }));
      const badZone = await attempt(b.mutation(api.users.updateProfile, { timeZone: "Mars/Olympus" }));
      const second = await b.query(api.users.me, {});
      const pick = (me: typeof first) => {
        if (me.state !== "ready") return me.state;
        const p = me.profile;
        return {
          displayName: p.displayName,
          appearance: p.appearance,
          aiEnabled: p.aiEnabled,
          aiPrefs: p.aiPrefs,
          timeZone: p.timeZone,
          locale: p.locale,
          notificationPrefs: p.notificationPrefs,
          reviewAppEdits: p.reviewAppEdits,
          platformRole: p.platformRole,
          status: p.status,
          deletionScheduledFor: p.deletionScheduledFor,
          avatarUrl: p.avatarUrl,
        };
      };
      // The shape is the same in both modes, field for field (the values of a few differ by design).
      const shape = first.state === "ready" ? { profile: Object.keys(first.profile).sort(), entitlements: Object.keys(first.profile.entitlements).sort() } : null;
      return { first: pick(first), second: pick(second), emptyName, badZone, shape };
    },
  }),
  scenario({
    name: "onboarding: starter notes once each, the Welcome note's theme, choices on the wrong step",
    async run(b, k) {
      const titles = async () => {
        const list = await b.query(api.documents.list, { scope: b.scope, view: "all", sort: "title", paginationOpts: { numItems: 200, cursor: null } });
        return list.page.map((d) => d.title);
      };
      const before = await titles();
      await b.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["study", "work"] });
      const added = (await titles()).filter((t) => !before.includes(t));
      // Choosing again (going Back and on) adds only what wasn't added yet.
      await b.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["work", "journal", "journal"] });
      const addedAgain = (await titles()).filter((t) => !before.includes(t) && !added.includes(t));
      const wrongStep = await attempt(b.mutation(api.users.completeOnboardingStep, { step: "style", useCases: ["work"] }));
      const unknownUse = await attempt(b.mutation(api.users.completeOnboardingStep, { step: "uses", useCases: ["knitting"] }));
      const unknownTheme = await attempt(b.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "art-999" }));
      const aiElsewhere = await attempt(b.mutation(api.users.completeOnboardingStep, { step: "appearance", aiEnabled: true }));
      const welcomeId = (await b.query(api.documents.list, { scope: b.scope, view: "all", paginationOpts: { numItems: 200, cursor: null } })).page.find((d) => d.title === WELCOME_TITLE)?.id;
      if (!welcomeId) throw new Error("no Welcome note");
      const welcome = k.name(welcomeId, "welcome");
      await b.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "art-03" });
      const themed = await b.query(api.documents.get, { documentId: welcome });
      await b.mutation(api.users.completeOnboardingStep, { step: "style", noteStyle: "plain" });
      const plain = await b.query(api.documents.get, { documentId: welcome });
      await b.mutation(api.users.completeOnboardingStep, { step: "appearance", appearance: "dark" });
      await b.mutation(api.users.completeOnboardingStep, { step: "ai", aiEnabled: false });
      const me = await b.query(api.users.me, {});
      const profile = me.state === "ready" ? me.profile : null;
      return {
        added,
        addedAgain,
        wrongStep,
        unknownUse,
        unknownTheme,
        aiElsewhere,
        themed: { cover: themed?.document.cover, style: themed?.document.style },
        plain: { cover: plain?.document.cover, style: plain?.document.style },
        useCases: profile?.onboardingUseCases,
        appearance: profile?.appearance,
        aiEnabled: profile?.aiEnabled,
      };
    },
  }),
  scenario({
    name: "profile picture: none to remove, an image that isn't there",
    async run(b) {
      const removed = await b.mutation(api.users.removeAvatar, {});
      const missing = await attempt(b.mutation(api.users.setAvatar, { fileId: "01JAAAAAAAAAAAAAAAAAAAAAAA" }));
      const me = await b.query(api.users.me, {});
      return { removed, missing, avatarUrl: me.state === "ready" ? me.profile.avatarUrl : me.state };
    },
  }),
];
