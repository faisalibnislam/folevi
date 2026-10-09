import { v } from "convex/values";
import { vScopeArg } from "./scope";

export const vPlatformRole = v.union(v.literal("super_admin"), v.literal("support_admin"), v.literal("ops_admin"));
export const vProfileStatus = v.union(
  v.literal("active"),
  v.literal("suspended"),
  v.literal("pending_deletion"),
  v.literal("deleted"),
);
export const vAppearance = v.union(v.literal("system"), v.literal("light"), v.literal("dark"));
/** A workspace membership role as stored: owner | admin | member (a member's access is `memberAccess`). */
export const vWorkspaceRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));
/** What a member (not an owner or admin) may do with the workspace's content. Unset = edit. */
export const vMemberAccess = v.union(v.literal("edit"), v.literal("comment"), v.literal("view"));
/**
 * The role an invitation or role change asks for: "member" (with a memberAccess) or "admin". The old member
 * roles (editor / commenter / viewer) are still accepted as input from older clients (the paused Mac app
 * sends them) and stored as member + the matching access (lib/auth.ts requestedRole). Drop them after the
 * Mac catch-up (docs/ACCOUNT_MODEL_PLAN.md §3b).
 */
export const vInviteRole = v.union(v.literal("admin"), v.literal("member"), v.literal("editor"), v.literal("commenter"), v.literal("viewer"));
/** A workspace plan's catalog id (convex/lib/plans.ts). */
export const vWorkspacePlanId = v.union(
  v.literal("workspace_free"),
  v.literal("workspace_core_monthly"),
  v.literal("workspace_core_yearly"),
  v.literal("workspace_pro_monthly"),
  v.literal("workspace_pro_yearly"),
  v.literal("workspace_pro_ai_monthly"),
  v.literal("workspace_pro_ai_yearly"),
);
/** A paid workspace plan's catalog id (what can be bought). */
export const vPaidWorkspacePlanId = v.union(
  v.literal("workspace_core_monthly"),
  v.literal("workspace_core_yearly"),
  v.literal("workspace_pro_monthly"),
  v.literal("workspace_pro_yearly"),
  v.literal("workspace_pro_ai_monthly"),
  v.literal("workspace_pro_ai_yearly"),
);
/** A Personal tier (lib/plans.ts). */
export const vPersonalTier = v.union(v.literal("free"), v.literal("core"), v.literal("pro"), v.literal("pro_ai"));
/** A paid Personal tier (what can be bought). */
export const vPaidPersonalTier = v.union(v.literal("core"), v.literal("pro"), v.literal("pro_ai"));
/** An AI credit pack (lib/plans.ts CREDIT_PACKS). */
export const vCreditPackId = v.union(v.literal("credits_500"), v.literal("credits_1000"));
export const vInterval = v.union(v.literal("month"), v.literal("year"));
export const vShareRole =v.union(v.literal("editor"), v.literal("commenter"), v.literal("viewer"));
/** Which kinds of notification appear in the bell (Settings → Notifications). */
export const vInAppPrefs = v.object({
  comments: v.boolean(),
  replies: v.boolean(),
  mentions: v.boolean(),
  shares: v.boolean(),
  access: v.boolean(),
});
/** Notification preferences. The top-level booleans are email choices (kept for existing rows). */
export const vNotificationPrefs = v.object({
  mentions: v.boolean(),
  comments: v.boolean(),
  shares: v.boolean(),
  invites: v.boolean(),
  digest: v.union(v.literal("off"), v.literal("daily")),
  productEmail: v.boolean(),
  /** Email for replies in threads you took part in. Unset = follows `comments`. */
  replies: v.optional(v.boolean()),
  /** Email when your access to a page or workspace changes. Unset = follows `shares`. */
  access: v.optional(v.boolean()),
  /** In-app (bell) notifications per kind. Unset = all on. */
  inApp: v.optional(vInAppPrefs),
});
export const vDocumentKind = v.union(
  v.literal("document"),
  v.literal("daily"),
  v.literal("template"),
  v.literal("collectionRow"),
);
export const vDocumentStyle = v.object({
  font: v.union(v.literal("sans"), v.literal("serif"), v.literal("mono"), v.literal("rounded")),
  width: v.union(v.literal("narrow"), v.literal("default"), v.literal("wide")),
  background: v.union(v.literal("paper"), v.literal("plain"), v.literal("tinted"), v.literal("grid")),
  accent: v.union(v.literal("accent"), v.literal("moss"), v.literal("marigold"), v.literal("plum"), v.literal("coral")),
  card: v.union(v.literal("folio"), v.literal("plain"), v.literal("tinted"), v.literal("outline")),
  /** Behind the page: "art:<cover art id>" or "color:<name>" (see apps/web/src/lib/cover.ts). */
  backdrop: v.optional(v.string()),
  sheet: v.optional(
    v.union(v.literal("white"), v.literal("paper"), v.literal("ivory"), v.literal("mist"), v.literal("sage"), v.literal("blush"), v.literal("night")),
  ),
  text: v.optional(v.union(v.literal("ink"), v.literal("slate"), v.literal("navy"), v.literal("forest"), v.literal("plum"), v.literal("brown"), v.literal("white"))),
  separator: v.optional(v.union(v.literal("line"), v.literal("dots"), v.literal("doodle"))),
  /** Blurs the page background behind the note (its style artwork, image or colour). */
  blur: v.optional(v.boolean()),
});
export const vDocumentCover = v.object({
  kind: v.union(v.literal("none"), v.literal("color"), v.literal("gradient"), v.literal("image"), v.literal("art")),
  value: v.optional(v.string()),
});
/** Colours picked from a note style image: page/text for light and dark themes, and how the cover reads. */
export const vImagePalette = v.object({
  paper: v.string(),
  ink: v.string(),
  paperDark: v.string(),
  inkDark: v.string(),
  tone: v.union(v.literal("deep"), v.literal("light")),
  // The accent, text and highlight colours (packages/design-tokens/src/palette.ts). Optional: palettes
  // saved before these existed lack them, and the app picks them again.
  accent: v.optional(v.string()),
  accentDark: v.optional(v.string()),
  text: v.optional(v.array(v.string())),
  textDark: v.optional(v.array(v.string())),
  names: v.optional(v.array(v.string())),
  highlight: v.optional(v.array(v.string())),
  highlightDark: v.optional(v.array(v.string())),
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
  scope: v.optional(v.union(vScopeArg, v.null())),
  workspaceId: v.optional(v.union(v.string(), v.null())),
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
    fields: v.array(v.union(v.literal("content"), v.literal("position"), v.literal("collapsed"))),
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
