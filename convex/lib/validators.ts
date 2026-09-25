import { v } from "convex/values";

export const vPlatformRole = v.union(v.literal("super_admin"), v.literal("support_admin"), v.literal("ops_admin"));
export const vProfileStatus = v.union(
  v.literal("active"),
  v.literal("suspended"),
  v.literal("pending_deletion"),
  v.literal("deleted"),
);
export const vAppearance = v.union(v.literal("system"), v.literal("light"), v.literal("dark"));
export const vWorkspaceRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("editor"),
  v.literal("commenter"),
  v.literal("viewer"),
);
export const vShareRole = v.union(v.literal("editor"), v.literal("commenter"), v.literal("viewer"));
export const vDocumentKind = v.union(
  v.literal("document"),
  v.literal("daily"),
  v.literal("template"),
  v.literal("collectionRow"),
);
export const vDocumentStyle = v.object({
  font: v.union(v.literal("sans"), v.literal("serif"), v.literal("mono")),
  width: v.union(v.literal("narrow"), v.literal("default"), v.literal("wide")),
  background: v.union(v.literal("paper"), v.literal("plain"), v.literal("tinted"), v.literal("grid")),
  accent: v.union(v.literal("accent"), v.literal("moss"), v.literal("marigold"), v.literal("plum"), v.literal("coral")),
  card: v.union(v.literal("folio"), v.literal("plain"), v.literal("tinted"), v.literal("outline")),
});
export const vDocumentCover = v.object({
  kind: v.union(v.literal("none"), v.literal("color"), v.literal("gradient"), v.literal("image")),
  value: v.optional(v.string()),
});
export const vCollectionPropertyType = v.union(
  v.literal("text"),
  v.literal("number"),
  v.literal("checkbox"),
  v.literal("date"),
  v.literal("select"),
  v.literal("multiSelect"),
  v.literal("url"),
  v.literal("person"),
  v.literal("relation"),
);
export const vCollectionViewType = v.union(v.literal("table"), v.literal("board"), v.literal("gallery"));

export const vInline = v.any();

export const vWireBlock = v.object({
  id: v.string(),
  type: v.string(),
  parentId: v.union(v.string(), v.null()),
  rank: v.string(),
  schemaVersion: v.number(),
  text: v.array(v.any()),
  props: v.any(),
  revision: v.optional(v.number()),
});

export const vDocumentCreate = v.object({
  id: v.string(),
  parentDocumentId: v.union(v.string(), v.null()),
  folderId: v.union(v.string(), v.null()),
  kind: vDocumentKind,
  title: v.string(),
  icon: v.union(v.string(), v.null()),
  style: v.optional(vDocumentStyle),
  cover: v.optional(vDocumentCover),
  dailyDate: v.optional(v.union(v.string(), v.null())),
  templateId: v.optional(v.union(v.string(), v.null())),
  collectionId: v.optional(v.union(v.string(), v.null())),
});

export const vDocumentPatch = v.object({
  title: v.optional(v.string()),
  icon: v.optional(v.union(v.string(), v.null())),
  cover: v.optional(vDocumentCover),
  style: v.optional(vDocumentStyle),
  folderId: v.optional(v.union(v.string(), v.null())),
  parentDocumentId: v.optional(v.union(v.string(), v.null())),
});

export const vSyncOp = v.union(
  v.object({
    opId: v.string(),
    kind: v.literal("block.upsert"),
    documentId: v.string(),
    block: vWireBlock,
    baseRevision: v.union(v.number(), v.null()),
    fields: v.array(v.union(v.literal("content"), v.literal("position"))),
  }),
  v.object({
    opId: v.string(),
    kind: v.literal("block.delete"),
    documentId: v.string(),
    blockId: v.string(),
    baseRevision: v.union(v.number(), v.null()),
  }),
  v.object({ opId: v.string(), kind: v.literal("block.restore"), documentId: v.string(), blockId: v.string() }),
  v.object({ opId: v.string(), kind: v.literal("document.create"), document: vDocumentCreate }),
  v.object({
    opId: v.string(),
    kind: v.literal("document.update"),
    documentId: v.string(),
    patch: vDocumentPatch,
    baseRevision: v.union(v.number(), v.null()),
  }),
);
