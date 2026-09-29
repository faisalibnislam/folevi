import type {
  BlockPropsMap,
  DocumentCover,
  DocumentKind,
  DocumentStyle,
  InlineNode,
  KnownBlockType,
} from "./generated/schema";

/** A block as stored on the server and exchanged on the wire. `type` may be unknown to this client. */
export interface WireBlock {
  id: string;
  type: string;
  parentId: string | null;
  rank: string;
  schemaVersion: number;
  text: InlineNode[];
  props: Record<string, unknown>;
  /** Server revision; absent for never-acknowledged local blocks. */
  revision?: number;
}

type KnownBlockOf<K extends KnownBlockType> = {
  id: string;
  type: K;
  parentId: string | null;
  rank: string;
  text: InlineNode[];
  props: BlockPropsMap[K];
  revision?: number;
};

export type KnownBlock = { [K in KnownBlockType]: KnownBlockOf<K> }[KnownBlockType];

/** A block written by a newer client. Preserved verbatim, rendered read-only, never dropped. */
export interface UnknownBlock {
  id: string;
  type: "unknown";
  parentId: string | null;
  rank: string;
  text: InlineNode[];
  props: { originalType: string; originalSchemaVersion: number; raw: Record<string, unknown> };
  revision?: number;
}

export type Block = KnownBlock | UnknownBlock;
export type BlockOf<K extends KnownBlockType> = KnownBlockOf<K>;

/**
 * Where content lives: the signed-in person's own Personal, or a team workspace (public id). Personal
 * is not a workspace, and a client can only ever name its own Personal.
 */
export type WireScope = { kind: "personal" } | { kind: "workspace"; workspaceId: string };

export interface WireDocument {
  id: string;
  /** The team workspace it's in; null when it's in someone's Personal (see `ownerProfileId`). */
  workspaceId: string | null;
  /** Whose Personal it's in; null in a team workspace. */
  ownerProfileId?: string | null;
  parentDocumentId: string | null;
  folderId: string | null;
  kind: DocumentKind;
  title: string;
  icon: string | null;
  cover: DocumentCover;
  style: DocumentStyle;
  dailyDate: string | null;
  templateId: string | null;
  collectionId: string | null;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  archivedAt: number | null;
  deletedAt: number | null;
  revision: number;
}

export interface WireDocumentCreate {
  id: string;
  parentDocumentId: string | null;
  folderId: string | null;
  kind: DocumentKind;
  title: string;
  icon: string | null;
  style?: DocumentStyle;
  cover?: DocumentCover;
  dailyDate?: string | null;
  templateId?: string | null;
  collectionId?: string | null;
  /**
   * Where to create the page: the caller's Personal or a team workspace. Ignored when `parentDocumentId`
   * is set (a nested page always lives in its parent's scope). Absent → the batch's routing scope (sync
   * protocol §Routing).
   */
  scope?: WireScope | null;
  /** Older clients: a team workspace to create the page in (public id). `scope` wins when both are set. */
  workspaceId?: string | null;
}

export interface WireDocumentPatch {
  title?: string;
  icon?: string | null;
  cover?: DocumentCover;
  style?: DocumentStyle;
  folderId?: string | null;
  parentDocumentId?: string | null;
}

export const DEFAULT_DOCUMENT_STYLE: DocumentStyle = {
  font: "sans",
  width: "wide",
  background: "paper",
  accent: "accent",
  card: "folio",
};

export const DEFAULT_COVER: DocumentCover = { kind: "none" };

/** Number of note styles (artworks "art-01" … "art-57"; packages/design-tokens/covers). */
export const NOTE_STYLE_COUNT = 57;

/** A random note style (test and sample data; new notes start Plain). */
export function randomNoteCover(random: () => number = Math.random): DocumentCover {
  const n = 1 + Math.floor(random() * NOTE_STYLE_COUNT);
  return { kind: "art", value: `art-${String(Math.min(n, NOTE_STYLE_COUNT)).padStart(2, "0")}` };
}
