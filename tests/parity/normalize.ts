// Makes two backends' answers comparable (docs/LOCAL_MODE_PLAN.md §2.5.3): what is generated differently
// in each (ids, timestamps, revisions and sequence numbers, the profile and device, pagination cursors)
// becomes a stable placeholder, `undefined` fields disappear (Convex drops them on the wire), and object
// keys are sorted. Arrays keep their order: order is behaviour.
//
// Ids keep their identity: the same id is the same placeholder everywhere in a result, so "this block's
// parent is that block" survives. Ids a scenario named (`k.id("note")`, `k.name(id, "folder")`) become
// `<note>`; others are numbered in the order they first appear (`<id:1>`).

export interface NormalizeOptions {
  /** Values to replace with a fixed name: profile id → "<profile>", a scenario's ids → "<note>". */
  known?: ReadonlyMap<string, string>;
  /** Keys dropped wherever they appear. */
  ignore?: readonly string[];
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** Convex document ids: lowercase base32, 31 or more characters. */
const CONVEX_ID = /^[0-9a-z]{31,40}$/;

const TIME_KEY = /(?:At|Time|Ms)$|^_creationTime$|^(?:time|now|timestamp|updated|created|lastSeen)$/;
const REVISION_KEYS = new Set(["revision", "baseRevision", "serverRevision", "contentRev", "titleRev", "seq", "head", "contentSeq", "nextCursor", "version"]);
const CURSOR_KEYS = new Set(["cursor", "continueCursor", "splitCursor", "endCursor", "pageStatus"]);
const PROFILE_KEYS = new Set(["profileId", "ownerProfileId", "createdBy", "lastEditedBy", "editedBy", "authorId", "authorProfileId", "assigneeId", "userId", "createdByName"]);
const DEVICE_KEYS = new Set(["deviceId", "device"]);
const ID_KEY = /^(?:id|_id|opId)$|Id$/;
const IDS_KEY = /Ids$/;

/** Milliseconds since the epoch between 2001 and 2286: a timestamp whatever its key is called. */
const looksLikeTime = (n: number) => Number.isInteger(n) && n >= 1e12 && n < 1e13;

export function normalize(value: unknown, opts: NormalizeOptions = {}): unknown {
  const known = opts.known ?? new Map<string, string>();
  const ignore = new Set(opts.ignore ?? []);
  const numbered = new Map<string, string>();

  const idPlaceholder = (id: string) => {
    const name = known.get(id);
    if (name) return name;
    let p = numbered.get(id);
    if (!p) {
      p = `<id:${numbered.size + 1}>`;
      numbered.set(id, p);
    }
    return p;
  };

  const leaf = (key: string | null, v: unknown): unknown => {
    if (typeof v === "string") {
      const name = known.get(v);
      if (name) return name;
      if (key !== null) {
        if (DEVICE_KEYS.has(key)) return "<device>";
        if (PROFILE_KEYS.has(key)) return "<profile>";
        if (CURSOR_KEYS.has(key)) return "<cursor>";
        if (ID_KEY.test(key) || IDS_KEY.test(key)) return idPlaceholder(v);
      }
      if (ULID.test(v) || CONVEX_ID.test(v)) return idPlaceholder(v);
      return v;
    }
    if (typeof v === "number") {
      if (key !== null) {
        if (REVISION_KEYS.has(key)) return "<rev>";
        if (TIME_KEY.test(key)) return "<time>";
      }
      if (looksLikeTime(v)) return "<time>";
      return v;
    }
    return v;
  };

  const walk = (key: string | null, v: unknown): unknown => {
    if (Array.isArray(v)) return v.map((item) => walk(key !== null && IDS_KEY.test(key) ? key : null, item));
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `<bytes:${(v as ArrayBuffer).byteLength}>`;
    if (v !== null && typeof v === "object") {
      if (key !== null && CURSOR_KEYS.has(key)) return "<cursor>";
      // Keys that are ids (documents.titles is keyed by document id) become placeholders too. Their
      // placeholders are given in the order the original keys sort, then the result is sorted by them. With
      // more than one id key a scenario hasn't named, that order is random: name them (k.name) first.
      const entries: [string, unknown][] = [];
      for (const k of Object.keys(v).sort()) {
        if (ignore.has(k)) continue;
        const child = (v as Record<string, unknown>)[k];
        if (child === undefined) continue;
        const isId = known.has(k) || ULID.test(k) || CONVEX_ID.test(k);
        entries.push([isId ? idPlaceholder(k) : k, walk(isId ? null : k, child)]);
      }
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries);
    }
    if (v === null) return key !== null && CURSOR_KEYS.has(key) ? "<cursor>" : null;
    return leaf(key, v);
  };

  return walk(null, value);
}
