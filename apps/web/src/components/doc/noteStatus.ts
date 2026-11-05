// What the note's bar says about the note before and after the server answers: who can open it (the Share
// button) and where it lives (the breadcrumb and the native note sidebar's "In ..." line). Each says nothing
// definite until it's known, so the first label a person sees is the right one (QA audit F01, F13).

/** The parts of `sharing.get` the Share button reads. */
export interface SharingLike {
  links: { expired: boolean }[];
  youAreGuest: boolean;
  people: { isYou: boolean }[];
  pendingInvites: unknown[];
  accessMode: string;
}

/**
 * The Share button's state: "loading" until the server says who can open the note (neutral, no lock), then
 * "link" (a public link), "people" (anyone else: people, an invitation, the whole workspace, or it's someone
 * else's note) or "private". Without sharing (local mode) a note is only ever yours.
 */
export type ShareIndicator = "loading" | "link" | "people" | "private";

export function shareIndicatorOf(sharing: SharingLike | null | undefined, o: { sharingEnabled: boolean; workspaceId: string | null | undefined }): ShareIndicator {
  if (!o.sharingEnabled) return "private";
  if (sharing === undefined) return "loading";
  if (sharing === null) return "private";
  if (sharing.links.some((l) => !l.expired)) return "link";
  if (sharing.youAreGuest || sharing.people.some((p) => !p.isYou) || sharing.pendingInvites.length || (sharing.accessMode === "workspace" && o.workspaceId)) return "people";
  return "private";
}

/** The Share button's description (shown in Folevi's own tooltip and read by screen readers). */
export function shareIndicatorLabel(s: ShareIndicator): string {
  switch (s) {
    case "loading":
      return "Checking who can open this";
    case "link":
      return "Anyone with the link can view";
    case "people":
      return "Shared with other people";
    case "private":
      return "Only you can open this";
  }
}

/**
 * The folder a note is in, as far as this device knows: a move waiting to be sent wins, then the server's
 * answer, then the folder it was created in (a note made on this device the server doesn't have yet).
 * `undefined` while nothing says (the note's still loading): show no place rather than guess Drafts.
 */
export function noteFolderIdOf(o: { movedTo: string | null | undefined; meta: { folder: { id: string } | null } | null | undefined; createdIn: string | null | undefined }): string | null | undefined {
  if (o.movedTo !== undefined) return o.movedTo;
  if (o.meta) return o.meta.folder?.id ?? null;
  if (o.createdIn !== undefined) return o.createdIn;
  return undefined;
}
