// The owner's first-run checklist on the admin Overview: what a new server still needs, in order, with one click to
// each step. A step is done when Folevi can see it's done (email on, people invited) or when the owner finished or
// skipped it (settings.setup, CONTRACT §8 addition). The checklist hides itself once every step is done.
import type { ServerSettings, SetupStep } from "@/lib/server-edition/refs";
import type { BackupList, RemoteState } from "./types";

export type ChecklistId = "name" | "owner" | "remote" | "email" | "backups" | "invite" | "apps";

export interface ChecklistItem {
  id: ChecklistId;
  title: string;
  /** What it is, or what was done. */
  detail: string;
  state: "done" | "skipped" | "todo";
  /** The step to mark when the owner skips it (none for steps that can't be skipped). */
  skipAs?: SetupStep[];
  href?: string;
  action?: string;
}

export function checklistItems(input: { settings: ServerSettings; people: number; invites: number; backups?: BackupList; remote?: RemoteState }): ChecklistItem[] {
  const { settings, people, invites, backups, remote } = input;
  const setup = settings.setup ?? {};
  const marked = (s: SetupStep) => setup[s] !== undefined;
  const items: ChecklistItem[] = [];

  const named = settings.name.trim() !== "" && settings.name !== "Folevi";
  items.push({ id: "name", title: "Name your server", detail: named ? `It's called ${settings.name}.` : "People see the name when they sign in.", state: named ? "done" : marked("name") ? "skipped" : "todo", skipAs: ["name"], href: "#server-name", action: "Name it" });

  items.push({ id: "owner", title: "Create the owner's account", detail: "That's you. You can hand ownership to someone else from People.", state: settings.ownerUserId ? "done" : "todo" });

  const linked = remote?.connect.state === "linked";
  const remoteDone = linked || Boolean(remote?.customDomain) || remote?.reachable === true;
  items.push({
    id: "remote",
    title: "Reach it from anywhere",
    detail: linked ? "Linked to a Folevi account." : remote?.customDomain ? `Uses ${remote.customDomain}.` : remoteDone ? "Reachable from the internet." : marked("remote") ? "At home only for now." : "So the apps work away from home too.",
    state: remoteDone ? "done" : marked("remote") ? "skipped" : "todo",
    skipAs: ["remote"],
    href: "/admin/remote",
    action: "Set up",
  });

  const emailOn = settings.email.mode !== "off";
  items.push({
    id: "email",
    title: "Send email",
    detail: emailOn ? (settings.email.mode === "folevi" ? "Through Folevi Mail." : "Through your own email account.") : marked("email") ? "Off. Invites go by link, and you reset passwords from People." : "For invites and password resets people do themselves.",
    state: emailOn ? "done" : marked("email") ? "skipped" : "todo",
    skipAs: ["email"],
    href: "/admin/email",
    action: "Set up",
  });

  const nightly = backups ? backups.schedule.enabled : true;
  const keySaved = marked("backupKey");
  items.push({
    id: "backups",
    title: "Back up, and save the backup key",
    detail: !nightly ? "Nightly backups are off." : keySaved ? "Nightly backups are on and you saved the key." : "Backups are on. Save the key you need to restore them on a new machine.",
    state: nightly && keySaved ? "done" : marked("backups") && marked("backupKey") ? "skipped" : "todo",
    skipAs: ["backups", "backupKey"],
    href: "/admin/backups#backup-key",
    action: keySaved ? "Turn on" : "Save the key",
  });

  const invited = people > 1 || invites > 0;
  items.push({
    id: "invite",
    title: "Invite people",
    detail: invited ? (people > 1 ? `${people} people have accounts.` : "Invite sent. It shows here once they join.") : "Family or team: by link, QR code or email.",
    state: invited ? "done" : marked("invite") ? "skipped" : "todo",
    skipAs: ["invite"],
    href: "/admin/people",
    action: "Invite",
  });

  items.push({
    id: "apps",
    title: "Connect your apps",
    detail: marked("apps") ? "Done." : "Add this server in Folevi for Mac, iPhone and iPad.",
    state: marked("apps") ? "done" : "todo",
    skipAs: ["apps"],
    href: "#connect-apps",
    action: "Show how",
  });
  return items;
}

/** True when the checklist has nothing left (or the owner hid it). */
export function checklistFinished(items: ChecklistItem[], settings: ServerSettings): boolean {
  return settings.setup?.checklist !== undefined || items.every((i) => i.state !== "todo");
}
