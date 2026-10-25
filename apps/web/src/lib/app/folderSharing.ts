// Folder sharing in the app (docs/SHARING.md): the words the Share dialogs, the shared folder page and the
// move warning use, kept here so they read the same everywhere (and can be tested on their own).

export type ShareRole = "viewer" | "commenter" | "editor";

export function roleLabel(role: ShareRole | string): string {
  return role === "editor" ? "Can edit" : role === "commenter" ? "Can comment" : "Can view";
}

const notes = (n: number) => (n === 1 ? "1 note" : `${n.toLocaleString("en-US")} notes`);
const people = (n: number) => (n === 1 ? "1 person" : `${n.toLocaleString("en-US")} people`);

/** The line at the top of a folder's Share dialog: what sharing this folder reaches. */
export function folderAccessSummary(o: { noteCount: number; people: number; personal: boolean }): string {
  const what = o.noteCount === 0 ? "its notes" : `its ${notes(o.noteCount)}`;
  const base = `People with access to this folder can see ${what}, in its subfolders too, and notes added later.`;
  if (o.people === 0) return `${base} ${o.personal ? "Only you can see it now." : "Now it’s only for the workspace, by each member’s role."}`;
  return `${base} It’s shared with ${people(o.people)}.`;
}

/** Who can see notes after a move changes it, as the warning before the move says it (null: nothing changes). */
export function moveWarning(c: { gainCount: number; loseCount: number; gains: string[]; loses: string[] }, count: number, folderName: string): { title: string; message: string } | null {
  if (!c.gainCount && !c.loseCount) return null;
  const subject = count === 1 ? "this note" : `these ${notes(count)}`;
  const named = (names: string[], total: number) => {
    const shown = names.slice(0, 3);
    const rest = total - shown.length;
    if (!shown.length) return people(total);
    return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0]!;
  };
  const parts: string[] = [];
  if (c.gainCount) parts.push(`${named(c.gains, c.gainCount)} will be able to see ${subject} through “${folderName}”.`);
  if (c.loseCount) parts.push(`${named(c.loses, c.loseCount)} will no longer see ${subject}: ${count === 1 ? "it was" : "they were"} shared with them through the folder ${count === 1 ? "it’s" : "they’re"} in now.`);
  return { title: c.loseCount && !c.gainCount ? "Move and stop sharing?" : "Move and change who can see it?", message: parts.join(" ") };
}

/** Where a shared folder lives, for Shared with Me and its page: "Acme · Design" or "Personal · Sam". */
export function sharedPlace(o: { workspaceName: string | null; ownerName: string | null }): string {
  return o.workspaceName ?? `Personal · ${o.ownerName ?? "someone"}`;
}
