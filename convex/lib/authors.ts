import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { keyedHash } from "./crypto";
import { identityImageUrl } from "./identityImages";

/** The colours people are drawn in (presence, version history, who edited what): note colours, never chrome. */
export const PERSON_COLORS = ["accent", "moss", "marigold", "plum", "coral", "ember"] as const;
export type PersonColor = (typeof PERSON_COLORS)[number];

/** A person's colour, the same everywhere they appear. */
export function personColor(profileId: Id<"profiles">): PersonColor {
  return PERSON_COLORS[parseInt(profileId.slice(-2), 36) % PERSON_COLORS.length] ?? "accent";
}

/** Who someone is, as clients see them: an opaque key (never the internal id), a name, a colour and their picture. */
export interface PersonView {
  key: string;
  name: string;
  color: PersonColor;
  avatarUrl: string | null;
}

/** Looks people up once each and describes them for clients. Missing (deleted) people read "Someone". */
export class People {
  private cache = new Map<string, Promise<PersonView>>();
  constructor(private ctx: QueryCtx | MutationCtx) {}

  get(profileId: Id<"profiles">): Promise<PersonView> {
    let hit = this.cache.get(profileId);
    if (!hit) {
      hit = (async () => {
        const p = (await this.ctx.db.get(profileId)) as Doc<"profiles"> | null;
        const live = p && p.status !== "deleted" ? p : null;
        return {
          key: (await keyedHash(profileId, "person")).slice(0, 16),
          name: live ? live.displayName : "Someone",
          color: personColor(profileId),
          avatarUrl: live ? await identityImageUrl(this.ctx, live.avatarFileId) : null,
        };
      })();
      this.cache.set(profileId, hit);
    }
    return hit;
  }

  /** Every person looked up so far, keyed by their client key. */
  async all(): Promise<Record<string, PersonView>> {
    const out: Record<string, PersonView> = {};
    for (const p of await Promise.all(this.cache.values())) out[p.key] = p;
    return out;
  }
}
