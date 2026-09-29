import { scopeIdKey, type WireScope } from "@folevi/editor-schema";

/** Where a document lives, as the server reports it: a team workspace, or someone's Personal (workspaceId null). */
export interface DocumentHome {
  workspaceId: string | null;
  ownerProfileId?: string | null;
}

/**
 * The scope key (`scopeIdKey`) of a document: its workspace's id, or "personal" when it's in a Personal.
 * Only meaningful for a Personal page that is yours (check `isMember` / ownership first): someone else's
 * Personal is never "personal" from your side.
 */
export function documentScopeKey(doc: DocumentHome): string {
  return doc.workspaceId === null ? scopeIdKey({ kind: "personal" }) : doc.workspaceId;
}

/** The scope argument for a document you're a member of (your own Personal, or a workspace you belong to). */
export function documentScope(doc: DocumentHome): WireScope {
  return doc.workspaceId === null ? { kind: "personal" } : { kind: "workspace", workspaceId: doc.workspaceId };
}

/**
 * Whether a document belongs to the current context (so folder actions apply to it): `isMember` says it's
 * in your own Personal or a workspace you belong to, and its scope must be the one you're working in.
 */
export function inCurrentScope(doc: DocumentHome, isMember: boolean, scopeKey: string): boolean {
  return isMember && documentScopeKey(doc) === scopeKey;
}
