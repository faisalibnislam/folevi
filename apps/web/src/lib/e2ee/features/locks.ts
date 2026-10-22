// Which notes are "Always fully encrypted" (docs/E2EE_DESIGN.md §7.1, WP8). A locked note never feeds any
// switch: no readable copy, no Foli AI context, no preview. The features must know before they send anything,
// because the server's refusal (e2ee_locked) would come after the text had already travelled.
//
// The replica's rows don't say yet whether a note is locked (WP7's LocalDocument has no lock fields), so this
// asks the server once per note version (e2ee.pull.document: `locked`, `lockedVia`, and the same for each
// parent page), and only in spaces that have locks at all (`lockedCount > 0`). When the replica learns the
// fields (`locked` / `lockedVia` on LocalDocument) they are used directly. Unknown means locked.
import { api } from "@/lib/convex/api";
import type { LocalDocument } from "@/lib/local/store";
import type { LocalReader } from "@/lib/local/registry";
import type { E2eeSpace } from "../router/deps";
import type { InnerClient } from "../router/types";

interface PulledLock {
  document: { id: string; parentDocumentId: string | null; locked?: boolean; lockedVia?: string | null; seq: number };
}

export class LockIndex {
  private cache = new Map<string, { seq: number; locked: boolean }>();

  constructor(
    private readonly server: Pick<InnerClient, "query">,
    private readonly space: () => Pick<E2eeSpace, "lockedCount">,
  ) {}

  /** Whether a note (or a page it sits under) is locked. Errs on the side of locked. */
  async isLocked(store: LocalReader, documentId: string, depth = 0): Promise<boolean> {
    if (this.space().lockedCount <= 0) return false;
    if (depth > 12) return true;
    const doc = (await store.get("documents", documentId)) as (LocalDocument & { locked?: boolean; lockedVia?: string | null }) | undefined;
    if (doc && typeof doc.locked === "boolean" && "lockedVia" in doc) {
      if (doc.locked || doc.lockedVia) return true;
      return doc.parentDocumentId ? await this.isLocked(store, doc.parentDocumentId, depth + 1) : false;
    }
    const seq = doc?.seq ?? -1;
    const hit = this.cache.get(documentId);
    if (hit && hit.seq === seq) return hit.locked;
    let locked = true;
    try {
      const r = (await this.server.query(api.e2ee.pull.document, { documentId })) as PulledLock | null;
      if (r) {
        locked = r.document.locked === true || Boolean(r.document.lockedVia);
        if (!locked && r.document.parentDocumentId) locked = await this.isLocked(store, r.document.parentDocumentId, depth + 1);
      }
    } catch {
      locked = true;
    }
    this.cache.set(documentId, { seq, locked });
    return locked;
  }

  forget(): void {
    this.cache.clear();
  }
}

const indexes = new Map<string, LockIndex>();

/** One lock index per space for this tab (the AI route and the workers share what they learned). */
export function lockIndexFor(server: Pick<InnerClient, "query">, space: () => Pick<E2eeSpace, "lockedCount" | "scope">): LockIndex {
  const s = space();
  const key = s.scope.kind === "personal" ? "personal" : `workspace:${s.scope.workspaceId}`;
  let hit = indexes.get(key);
  if (!hit) indexes.set(key, (hit = new LockIndex(server, space)));
  return hit;
}

/** Sign-out or lock: what was learned goes. */
export function forgetLocks(): void {
  indexes.clear();
}
