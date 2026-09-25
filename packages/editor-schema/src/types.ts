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

export interface WireDocument {
  id: string;
  workspaceId: string;
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
  width: "default",
  background: "paper",
  accent: "accent",
  card: "folio",
};

export const DEFAULT_COVER: DocumentCover = { kind: "none" };
