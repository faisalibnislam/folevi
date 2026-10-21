// Which spaces are e2ee-active, and which space a call concerns (docs/E2EE_DESIGN.md §6.4, WP7).
//
// The index knows every e2ee-active space the person can open (e2ee.spaces.mine) and, for each, the ids its
// replica holds: notes (and whether each is sealed), folders, tags, collections, comment threads, comments,
// files and versions. Notes opened outside a replica (a guest's page, through a decoder) are added as they
// are seen. `resolveSpace` applies the rules of §6.4 to a call's arguments.
import type { WireScope } from "@folevi/editor-schema";
import { isEncryptedLevel, scopeKeyOf, type E2eeSpace } from "./deps";

/** The kinds of id the index keeps, besides notes. */
export type RefKind = "folder" | "tag" | "collection" | "thread" | "comment" | "file" | "snapshot";

/** The argument names §6.4 looks at, in order, and what each names. */
const ID_ARGS: readonly [string, RefKind | "document"][] = [
  ["documentId", "document"],
  ["parentDocumentId", "document"],
  ["sourceId", "document"],
  ["targetDocumentId", "document"],
  ["folderId", "folder"],
  ["tagId", "tag"],
  ["collectionId", "collection"],
  ["threadId", "thread"],
  ["commentId", "comment"],
  ["fileId", "file"],
  ["snapshotId", "snapshot"],
  ["versionId", "snapshot"],
];

interface DocEntry {
  scope: string;
  sealed: boolean;
  /** Its opened title and icon (labels of links to it, generic titles filled in). */
  title?: string;
  icon?: string | null;
}

interface RefEntry {
  scope: string;
  documentId: string | null;
}

/** What `resolveSpace` found for a call. */
export interface Resolution {
  /** The e2ee-active space the call concerns, or null (Standard: every call passes). */
  space: E2eeSpace | null;
  /** The note the call names (directly, or through a folder, comment, file …), if known. */
  documentId: string | null;
  /** Whether that note is sealed. */
  sealed: boolean;
  /** How it was found: an argument ("documentId", …), the scope argument, or the context scope. */
  via: string;
  /** Whether a route should apply (an e2ee-active space, or a sealed note). */
  active: boolean;
}

const NONE: Resolution = Object.freeze({ space: null, documentId: null, sealed: false, via: "none", active: false });

export class SpaceIndex {
  private spaces = new Map<string, E2eeSpace>();
  private docs = new Map<string, DocEntry>();
  private refs = new Map<string, RefEntry>();
  private listeners = new Set<() => void>();
  private contextScope: WireScope | null = null;

  // ---- spaces -----------------------------------------------------------------------------------------

  /** Replaces the list of e2ee-active spaces (from e2ee.spaces.mine). */
  setSpaces(list: readonly E2eeSpace[]): void {
    const next = new Map(list.map((s) => [scopeKeyOf(s.scope), s]));
    const changed = next.size !== this.spaces.size || [...next].some(([k, s]) => JSON.stringify(this.spaces.get(k)) !== JSON.stringify(s));
    this.spaces = next;
    if (changed) this.emit();
  }

  /** Every e2ee-active space. */
  list(): E2eeSpace[] {
    return [...this.spaces.values()];
  }

  /** The e2ee-active space of a scope, or null. */
  get(scope: WireScope | string | null | undefined): E2eeSpace | null {
    if (!scope) return null;
    return this.spaces.get(typeof scope === "string" ? scope : scopeKeyOf(scope)) ?? null;
  }

  /** The space whose AAD scope id is `scopeId` (`personal:<id>`, `workspace:<id>`). */
  byScopeId(scopeId: string): E2eeSpace | null {
    for (const s of this.spaces.values()) if (s.scopeId === scopeId) return s;
    return null;
  }

  /** Whether any space needs the device (the router has work at all). */
  get any(): boolean {
    return this.spaces.size > 0;
  }

  /** The current context (AppStateProvider's scope): where calls naming nothing else go (§6.4 rule 3). */
  setContextScope(scope: WireScope | null): void {
    this.contextScope = scope;
  }

  get context(): WireScope | null {
    return this.contextScope;
  }

  // ---- ids --------------------------------------------------------------------------------------------

  /** Records a note: its space and whether it's sealed. */
  noteDocument(id: string, scope: WireScope | string, sealed: boolean, label?: { title: string; icon: string | null }): void {
    const key = typeof scope === "string" ? scope : scopeKeyOf(scope);
    const had = this.docs.get(id);
    this.docs.set(id, { scope: key, sealed, title: label?.title ?? had?.title, icon: label ? label.icon : had?.icon });
  }

  /** A note's opened title and icon, if the index has seen them. */
  label(id: string): { title: string; icon: string | null } | null {
    const d = this.docs.get(id);
    return d && d.title !== undefined ? { title: d.title, icon: d.icon ?? null } : null;
  }

  forgetDocument(id: string): void {
    this.docs.delete(id);
  }

  /** Records another id (a folder, a comment, a file …) and the note it belongs to, if any. */
  noteRef(kind: RefKind, id: string, scope: WireScope | string, documentId: string | null = null): void {
    const key = typeof scope === "string" ? scope : scopeKeyOf(scope);
    this.refs.set(`${kind}:${id}`, { scope: key, documentId });
  }

  /** Forgets everything recorded for a scope (its replica closed or the person lost access). */
  forgetScope(scope: WireScope | string): void {
    const key = typeof scope === "string" ? scope : scopeKeyOf(scope);
    for (const [id, d] of this.docs) if (d.scope === key) this.docs.delete(id);
    for (const [id, r] of this.refs) if (r.scope === key) this.refs.delete(id);
  }

  /** The space and sealed state of a note, if the index knows it. */
  document(id: string): DocEntry | null {
    return this.docs.get(id) ?? null;
  }

  /** §12 WP7 `isSealedDocument`. */
  isSealed(documentId: string): boolean {
    return this.docs.get(documentId)?.sealed === true;
  }

  ref(kind: RefKind, id: string): RefEntry | null {
    return this.refs.get(`${kind}:${id}`) ?? null;
  }

  // ---- resolution (§6.4) ------------------------------------------------------------------------------

  /**
   * Which space a call concerns: 1. `args.scope`; 2. the first id argument the index knows; 3. the context
   * scope when the call names no id at all. An id the index doesn't know belongs to a Standard space (or one
   * this person can't decrypt): the call passes. A route applies only to an e2ee-active space or a sealed note.
   */
  resolve(args: Record<string, unknown> | undefined | null): Resolution {
    if (!this.spaces.size && !this.docs.size) return NONE;
    const a = args ?? {};
    for (const [name, kind] of ID_ARGS) {
      const value = a[name];
      if (typeof value !== "string" || !value) continue;
      if (kind === "document") {
        const d = this.docs.get(value);
        if (!d) return { ...NONE, via: name };
        const space = this.spaces.get(d.scope) ?? null;
        return { space, documentId: value, sealed: d.sealed, via: name, active: d.sealed || isActive(space) };
      }
      const r = this.refs.get(`${kind}:${value}`);
      if (!r) return { ...NONE, via: name };
      const space = this.spaces.get(r.scope) ?? null;
      const sealed = r.documentId ? this.docs.get(r.documentId)?.sealed === true : false;
      return { space, documentId: r.documentId, sealed, via: name, active: sealed || isActive(space) };
    }
    const scope = a.scope as WireScope | undefined | null;
    if (scope && typeof scope === "object" && "kind" in scope) {
      const space = this.get(scope);
      return { space, documentId: null, sealed: false, via: "scope", active: isActive(space) };
    }
    if (this.contextScope) {
      const space = this.get(this.contextScope);
      return { space, documentId: null, sealed: false, via: "context", active: isActive(space) };
    }
    return NONE;
  }

  // ---- changes ----------------------------------------------------------------------------------------

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }
}

function isActive(space: E2eeSpace | null): boolean {
  return space !== null && (isEncryptedLevel(space) || space.lockedCount > 0 || space.state === "disabling");
}
