import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vAppearance,
  vCollectionPropertyType,
  vCollectionViewType,
  vDocumentCover,
  vImagePalette,
  vDocumentKind,
  vDocumentStyle,
  vPlatformRole,
  vNotificationPrefs,
  vProfileStatus,
  vMemberAccess,
  vShareRole,
  vPersonalTier,
  vWorkspacePlanId,
  vWorkspaceRole,
} from "./lib/validators";
import { vAiAction } from "./lib/aiActions";
import { vAiContext } from "./lib/ai/chat";
import { vAgentOp, vRunNote, vRunStatus } from "./lib/ai/tools/ops";
import { vReportSource, vResearchStep } from "./lib/ai/research";
import { vMemoryKind } from "./lib/ai/memory";
import { vAiFeature } from "./lib/ai/usage";

/**
 * Where a content row lives: exactly one of these is set (convex/lib/scope.ts).
 *   ownerProfileId: the row is in that person's Personal (Personal is not a workspace);
 *   workspaceId:    the row is in a team workspace.
 * Every insert into a scoped table goes through `insertScoped` (checked by tests/convex/static), and
 * `migrations.verifyAccountModel` reports any row with both or neither.
 */
const scoped = {
  workspaceId: v.optional(v.id("workspaces")),
  ownerProfileId: v.optional(v.id("profiles")),
};

/**
 * Folevi data model. Every table that holds content carries its scope (`scoped` above) so reads can be
 * authorized and listed per scope, and a `seq` stamped from the scope's change counter (its `scopeCounters`
 * row; see lib/seq.ts and SYNC_PROTOCOL.md). Client-visible identity uses
 * `publicId` (ULID) fields; Convex `_id`s never leave the backend as identity.
 */
export default defineSchema({
  profiles: defineTable({
    tokenIdentifier: v.string(),
    authSubject: v.string(),
    authIssuer: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    mfaVerified: v.boolean(),
    displayName: v.string(),
    avatarFileId: v.optional(v.id("files")),
    appearance: vAppearance,
    /** The AI assistant (Google Gemini). Unset = on; false = off, and the server refuses AI requests. */
    aiEnabled: v.optional(v.boolean()),
    /**
     * AI settings (lib/ai/prefs.ts; unset = the default). History (on): conversations are kept until
     * deleted; off, a conversation lasts only while its chat is open. The rest: memory (on), suggestions
     * (on), reading attachments (on), web research (on), digests (off).
     */
    aiHistory: v.optional(v.boolean()),
    aiMemory: v.optional(v.boolean()),
    aiSuggestions: v.optional(v.boolean()),
    aiAttachments: v.optional(v.boolean()),
    aiWebResearch: v.optional(v.boolean()),
    aiDigests: v.optional(v.boolean()),
    /** When the person dismissed the AI's first-time introduction (unset = not yet; components/ai/AiIntro.tsx). */
    aiIntroDismissedAt: v.optional(v.number()),
    locale: v.string(),
    timeZone: v.string(),
    /** Where onboarding is (convex/lib/onboarding.ts ONBOARDING_STEPS). "workspace" is the first step. */
    onboardingStep: v.union(
      v.literal("workspace"),
      v.literal("uses"),
      v.literal("style"),
      v.literal("appearance"),
      v.literal("ai"),
      v.literal("welcome"),
      v.literal("done"),
    ),
    /** Use cases picked during onboarding whose starter pages were added (USE_CASES ids; unset = none). */
    onboardingUseCases: v.optional(v.array(v.string())),
    platformRole: v.optional(vPlatformRole),
    status: vProfileStatus,
    suspendedReason: v.optional(v.string()),
    /**
     * Legacy change counter of this person's Personal (unset = 0). The counter now lives in `scopeCounters`;
     * this is only read once, to seed that row on the Personal's first change since the move (lib/seq.ts).
     */
    personalChangeSeq: v.optional(v.number()),
    /** Bytes stored in this person's Personal (unset = 0), checked against their Personal plan only. */
    personalStorageUsedBytes: v.optional(v.number()),
    /** Documents in this person's Personal (unset = 0), for admin views. */
    personalDocumentCount: v.optional(v.number()),
    notificationPrefs: vNotificationPrefs,
    createdAt: v.number(),
    lastActiveAt: v.number(),
    deletionScheduledFor: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_platform_role", ["platformRole"])
    .index("by_created", ["createdAt"]),

  /** Team workspaces (Personal is not a workspace: it has no row). */
  workspaces: defineTable({
    publicId: v.string(),
    name: v.string(),
    ownerId: v.id("profiles"),
    icon: v.optional(v.string()),
    /** Square logo (a `files` row of kind "logo", counted in this workspace's storage). */
    logoFileId: v.optional(v.id("files")),
    /** Legacy change counter, read once to seed the workspace's `scopeCounters` row (lib/seq.ts). */
    changeSeq: v.number(),
    status: v.union(v.literal("active"), v.literal("suspended"), v.literal("deleting")),
    storageUsedBytes: v.number(),
    /** The limit shown to older clients (convex/lib/entitlements.ts decides the real one). */
    storageQuotaBytes: v.number(),
    /** A storage limit set by an admin for this workspace; replaces its plan's. */
    storageQuotaOverrideBytes: v.optional(v.number()),
    memberLimit: v.number(),
    documentCount: v.number(),
    /**
     * The owner asked to delete this workspace; it's purged at this time (a `deletionJobs` row of kind
     * "workspace"). Until then it's read-only for the owner (who can cancel) and hidden from everyone else.
     */
    deletionScheduledFor: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_public_id", ["publicId"])
    .index("by_owner", ["ownerId"])
    .index("by_created", ["createdAt"]),

  /**
   * Change counter of a scope (lib/seq.ts): `key` is scopeKey(scope). Kept off the profile and workspace
   * rows so a sync push doesn't invalidate every query that reads those. A scope with no row yet still
   * has its counter on the old `personalChangeSeq` / `changeSeq` field.
   */
  scopeCounters: defineTable({
    key: v.string(),
    seq: v.number(),
  }).index("by_key", ["key"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    profileId: v.id("profiles"),
    role: vWorkspaceRole,
    /** A member's access to the workspace's content (unset = edit). Ignored for owners and admins. */
    memberAccess: v.optional(vMemberAccess),
    /** An admin the owner allowed to manage the workspace's plan and billing (unset = no). Owners always can. */
    canManageBilling: v.optional(v.boolean()),
    joinedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_profile", ["profileId"])
    .index("by_workspace_profile", ["workspaceId", "profileId"]),

  workspaceInvites: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    email: v.string(),
    role: vWorkspaceRole,
    /** For a member invitation: their access (unset = edit). */
    memberAccess: v.optional(vMemberAccess),
    tokenHash: v.string(),
    invitedBy: v.id("profiles"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
    expiresAt: v.number(),
    createdAt: v.number(),
    acceptedBy: v.optional(v.id("profiles")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_email", ["email"])
    .index("by_public_id", ["publicId"])
    // Expiring pending invitations (maintenance.housekeeping).
    .index("by_status_expires", ["status", "expiresAt"]),

  folders: defineTable({
    publicId: v.string(),
    ...scoped,
    parentFolderId: v.optional(v.id("folders")),
    name: v.string(),
    /** Legacy: folders used to take an emoji. Folders now show a coloured folder (color). */
    icon: v.optional(v.string()),
    /** One of FOLDER_COLORS (convex/lib/folderColors.ts); unset = the default colour. */
    color: v.optional(v.string()),
    rank: v.string(),
    createdBy: v.id("profiles"),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    seq: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_public_id", ["publicId"])
    .index("by_parent", ["parentFolderId"]),

  tags: defineTable({
    publicId: v.string(),
    ...scoped,
    name: v.string(),
    normalizedName: v.string(),
    color: v.string(),
    createdAt: v.number(),
    seq: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_name", ["workspaceId", "normalizedName"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_owner_name", ["ownerProfileId", "normalizedName"])
    .index("by_public_id", ["publicId"]),

  documentTags: defineTable({
    ...scoped,
    documentId: v.id("documents"),
    tagId: v.id("tags"),
  })
    .index("by_document", ["documentId"])
    .index("by_tag", ["tagId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  documents: defineTable({
    publicId: v.string(),
    ...scoped,
    parentDocumentId: v.optional(v.id("documents")),
    folderId: v.optional(v.id("folders")),
    kind: vDocumentKind,
    title: v.string(),
    icon: v.optional(v.string()),
    cover: vDocumentCover,
    style: vDocumentStyle,
    dailyDate: v.optional(v.string()),
    dailyOwnerId: v.optional(v.id("profiles")),
    templateKey: v.optional(v.string()),
    collectionId: v.optional(v.id("collections")),
    accessMode: v.union(v.literal("workspace"), v.literal("restricted")),
    rank: v.string(),
    createdBy: v.id("profiles"),
    lastEditedBy: v.id("profiles"),
    /** When the automatic version for the edits since the last one is due (documents.autoVersion). */
    versionDueAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("profiles")),
    inTrash: v.boolean(),
    revision: v.number(),
    titleRev: v.number(),
    seq: v.number(),
    contentSeq: v.number(),
    searchText: v.string(),
    wordCount: v.number(),
    charCount: v.number(),
    blockCount: v.number(),
    excerpt: v.string(),
    /** First blocks, trimmed, for page-thumbnail cards (derived; see lib/documents.ts buildPreview). */
    preview: v.optional(
      v.array(
        v.object({
          t: v.string(),
          x: v.string(),
          l: v.optional(v.number()),
          c: v.optional(v.boolean()),
          d: v.optional(v.number()),
          rows: v.optional(v.array(v.array(v.string()))),
        }),
      ),
    ),
  })
    .index("by_public_id", ["publicId"])
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_workspace_seq", ["workspaceId", "seq"])
    .index("by_workspace_trash", ["workspaceId", "inTrash", "updatedAt"])
    // Server-side ordering for document lists (documents.list sort = created / title / manual).
    .index("by_workspace_trash_created", ["workspaceId", "inTrash", "createdAt"])
    .index("by_workspace_trash_title", ["workspaceId", "inTrash", "title"])
    .index("by_workspace_trash_rank", ["workspaceId", "inTrash", "rank"])
    .index("by_parent", ["parentDocumentId"])
    .index("by_folder", ["folderId"])
    // Drafts (pages in no folder) per workspace, e.g. the sidebar's Drafts count.
    .index("by_workspace_folder", ["workspaceId", "folderId"])
    .index("by_daily", ["workspaceId", "dailyOwnerId", "dailyDate"])
    .index("by_workspace_kind", ["workspaceId", "kind"])
    // Personal twins of the workspace indexes above (a Personal row has no workspaceId).
    .index("by_owner_updated", ["ownerProfileId", "updatedAt"])
    .index("by_owner_created", ["ownerProfileId", "createdAt"])
    .index("by_owner_seq", ["ownerProfileId", "seq"])
    .index("by_owner_trash", ["ownerProfileId", "inTrash", "updatedAt"])
    .index("by_owner_trash_created", ["ownerProfileId", "inTrash", "createdAt"])
    .index("by_owner_trash_title", ["ownerProfileId", "inTrash", "title"])
    .index("by_owner_trash_rank", ["ownerProfileId", "inTrash", "rank"])
    .index("by_owner_folder", ["ownerProfileId", "folderId"])
    .index("by_owner_daily", ["ownerProfileId", "dailyOwnerId", "dailyDate"])
    .index("by_owner_kind", ["ownerProfileId", "kind"])
    .index("by_collection", ["collectionId"])
    // Listed pages without scanning the scope: Drafts (top level, not trashed or archived, no folder) and
    // the Archive (archivedAt set), per workspace and per Personal.
    .index("by_workspace_listed", ["workspaceId", "parentDocumentId", "inTrash", "archivedAt", "folderId"])
    .index("by_owner_listed", ["ownerProfileId", "parentDocumentId", "inTrash", "archivedAt", "folderId"])
    // A folder's listed pages, most recently edited first (folder views, All folders, Home).
    .index("by_folder_listed", ["folderId", "parentDocumentId", "inTrash", "archivedAt", "updatedAt"])
    // Whether a workspace has any restricted page at all (lib/auth.ts PageReader.opensAllInScope).
    .index("by_workspace_access", ["workspaceId", "accessMode"])
    // Trash retention (maintenance.purgeExpiredTrash): pages in Trash, oldest deletion first.
    .index("by_trash_deleted", ["inTrash", "deletedAt"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["workspaceId", "ownerProfileId", "inTrash", "folderId", "createdBy", "kind"],
    })
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["workspaceId", "ownerProfileId", "inTrash"],
    }),

  documentLinks: defineTable({
    ...scoped,
    sourceDocumentId: v.id("documents"),
    targetPublicId: v.string(),
    blockId: v.string(),
  })
    .index("by_target", ["targetPublicId"])
    .index("by_source_block", ["sourceDocumentId", "blockId"])
    .index("by_source", ["sourceDocumentId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  stars: defineTable({
    profileId: v.id("profiles"),
    documentId: v.id("documents"),
    /** The starred document's scope. */
    ...scoped,
    createdAt: v.number(),
  })
    .index("by_profile", ["profileId", "createdAt"])
    .index("by_profile_document", ["profileId", "documentId"])
    .index("by_document", ["documentId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  recents: defineTable({
    profileId: v.id("profiles"),
    documentId: v.id("documents"),
    /** The viewed document's scope. */
    ...scoped,
    viewedAt: v.number(),
  })
    .index("by_profile_viewed", ["profileId", "viewedAt"])
    .index("by_profile_document", ["profileId", "documentId"])
    .index("by_document", ["documentId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  /**
   * Notes a person removed from their Home "Recent notes" (per person, never shared). A note stays hidden
   * until it's edited after `hiddenAt` (by anyone) or the person opens it again (the row is then dropped).
   */
  recentHidden: defineTable({
    profileId: v.id("profiles"),
    documentId: v.id("documents"),
    /** The hidden document's scope. */
    ...scoped,
    hiddenAt: v.number(),
  })
    .index("by_profile_workspace", ["profileId", "workspaceId"])
    .index("by_profile_owner", ["profileId", "ownerProfileId"])
    .index("by_profile_document", ["profileId", "documentId"])
    .index("by_document", ["documentId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  blocks: defineTable({
    blockId: v.string(),
    documentId: v.id("documents"),
    ...scoped,
    parentId: v.union(v.string(), v.null()),
    rank: v.string(),
    type: v.string(),
    schemaVersion: v.number(),
    text: v.any(),
    props: v.any(),
    revision: v.number(),
    contentRev: v.number(),
    positionRev: v.number(),
    seq: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedBy: v.id("profiles"),
    deletedAt: v.optional(v.number()),
  })
    .index("by_document", ["documentId"])
    // A page's live blocks (deletedAt unset) without reading its tombstones (lib/documents.ts liveBlocks).
    .index("by_document_deleted", ["documentId", "deletedAt"])
    // Tombstone retention (maintenance.purgeTombstones).
    .index("by_deleted", ["deletedAt"])
    .index("by_block_id", ["blockId"])
    .index("by_workspace_seq", ["workspaceId", "seq"])
    .index("by_owner_seq", ["ownerProfileId", "seq"]),

  documentSnapshots: defineTable({
    documentId: v.id("documents"),
    ...scoped,
    publicId: v.string(),
    reason: v.union(v.literal("idle"), v.literal("close"), v.literal("before_restore"), v.literal("manual"), v.literal("import"), v.literal("ai_run")),
    title: v.string(),
    content: v.optional(v.string()),
    chunkCount: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    blockCount: v.number(),
    sizeBytes: v.number(),
    contentSeq: v.number(),
    createdBy: v.id("profiles"),
    createdAt: v.number(),
    /** A name someone gave this version ("Sent to the client"). Named versions are never cleaned up. */
    name: v.optional(v.string()),
    /** Who changed the page since the version before this one, most changes first (unset on older rows). */
    editors: v.optional(v.array(v.id("profiles"))),
  })
    .index("by_document", ["documentId", "createdAt"])
    .index("by_document_name", ["documentId", "name"])
    .index("by_public_id", ["publicId"])
    .index("by_created", ["createdAt"])
    .index("by_storage", ["storageId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  snapshotChunks: defineTable({
    snapshotId: v.id("documentSnapshots"),
    index: v.number(),
    data: v.string(),
  }).index("by_snapshot", ["snapshotId", "index"]),

  /**
   * Plans: a person's Personal plan (one row per profile) or a team workspace's plan (one row per workspace).
   * Exactly one of `profileId` / `workspaceId` is set, matching `ownerType`; rows are written only through convex/lib/billing.ts.
   *
   * Personal rows are created at sign-up with a 7-day Pro AI trial and store the tier in `plan`. Workspace
   * rows store the catalog id in `planId` and the billed seat count in `quantity`. Paid plans come from the
   * payment provider (Polar webhooks, provider "polar"), a development test purchase ("test"), or an admin
   * ("manual"); admins can also override storage and devices on Personal plans. docs/BILLING.md.
   */
  subscriptions: defineTable({
    /** "user" (Personal) or "workspace"; unset on older rows = "user". */
    ownerType: v.union(v.literal("user"), v.literal("workspace")),
    /** Personal rows: the person. */
    profileId: v.optional(v.id("profiles")),
    /** Workspace rows: the workspace (the plan belongs to it, not to whoever owns it). */
    workspaceId: v.optional(v.id("workspaces")),
    /** Personal rows: the tier. Workspace rows leave it unset. */
    plan: v.optional(vPersonalTier),
    /**
     * Legacy, never read or written: 2 on rows the January 2027 plan migration wrote or checked (it ran on
     * 2026-09-30 and was removed). Kept so those rows still match the schema.
     */
    catalogVersion: v.optional(v.number()),
    /** Workspace rows: the catalog plan id (convex/lib/plans.ts). */
    planId: v.optional(vWorkspacePlanId),
    /** Workspace rows: member seats billed (the provider's subscription seats). */
    quantity: v.optional(v.number()),
    /** Workspace rows: when a seat sync was scheduled (cleared when it runs; lib/seats.ts). */
    seatSyncScheduledAt: v.optional(v.number()),
    /** "Visa •••• 4242", when the provider has told us (workspace rows). */
    paymentMethod: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
    status: v.union(v.literal("active"), v.literal("past_due"), v.literal("canceled")),
    /** "stripe" only on rows from before Polar (Stripe was never live). */
    provider: v.union(v.literal("none"), v.literal("polar"), v.literal("manual"), v.literal("test"), v.literal("stripe")),
    trialEndsAt: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    /** Polar: the customer (always the person who bought it; external_id = their profile id). */
    polarCustomerId: v.optional(v.string()),
    polarSubscriptionId: v.optional(v.string()),
    polarProductId: v.optional(v.string()),
    /** Workspace rows billed through Polar: the person whose Polar customer pays (only they get the portal). */
    polarBuyerId: v.optional(v.id("profiles")),
    /** Polar's event time (ms) of the last subscription event applied; older events are ignored. */
    polarEventAt: v.optional(v.number()),
    storageOverrideBytes: v.optional(v.number()),
    /** Admin-set device limit (a number, or unlimited); unset = the plan's. */
    deviceLimitOverride: v.optional(v.union(v.number(), v.literal("unlimited"))),
    /** When the current paid plan started (for conversion and churn analytics). */
    paidSince: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    /** Legacy, never read: AI grants before AI credits (admins now grant credits, aiCreditPacks). */
    aiGrant: v.optional(v.boolean()),
    aiGrantUntil: v.optional(v.number()),
    /** Legacy, never written: Stripe fields from before Polar (Stripe was never live). */
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripeSubscriptionItemId: v.optional(v.string()),
    stripeEventCreatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_workspace", ["workspaceId"])
    // Paid workspace plans whose period has ended, per plan and provider (workspaceBilling.settleExpiredWorkspacePlans).
    .index("by_owner_type_plan_provider_period", ["ownerType", "planId", "provider", "currentPeriodEnd"])
    .index("by_plan", ["plan"])
    // Personal plans whose period has ended, per tier and provider (billing.settleExpiredPlans).
    .index("by_plan_provider_period", ["plan", "provider", "currentPeriodEnd"])
    .index("by_polar_subscription", ["polarSubscriptionId"]),

  /**
   * Money received (and refunds), for billing history and revenue analytics. Amounts in cents. Exactly one
   * of `profileId` (a Personal plan, or credits a person bought) / `workspaceId` (a workspace plan), so the
   * two histories never mix.
   */
  payments: defineTable({
    profileId: v.optional(v.id("profiles")),
    workspaceId: v.optional(v.id("workspaces")),
    amountCents: v.number(),
    currency: v.string(),
    /** What was paid for: a plan tier, or "credits" (an AI credit pack). */
    plan: v.union(v.literal("core"), v.literal("pro"), v.literal("pro_ai"), v.literal("credits")),
    /** Legacy, never read or written (see subscriptions.catalogVersion). */
    catalogVersion: v.optional(v.number()),
    /** Workspace payments: the catalog plan id and the seats billed. */
    planId: v.optional(vWorkspacePlanId),
    quantity: v.optional(v.number()),
    /** Plans: the billing interval. Unset for credit packs. */
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
    /** Credit packs: how many credits, and the workspace seat they were bought for (unset = Personal). */
    credits: v.optional(v.number()),
    creditsWorkspaceId: v.optional(v.id("workspaces")),
    status: v.union(v.literal("paid"), v.literal("refunded"), v.literal("failed")),
    provider: v.union(v.literal("polar"), v.literal("manual"), v.literal("test"), v.literal("stripe")),
    /** The provider's order id (payments are keyed by it, so a redelivered event updates the same row). */
    providerRef: v.optional(v.string()),
    /** Money refunded so far (a partial refund leaves the status "paid"). */
    refundedCents: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_profile_created", ["profileId", "createdAt"])
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_provider_ref", ["providerRef"]),

  /** Payment provider webhook deliveries already applied (by webhook id), so a redelivery is applied once. */
  billingEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    /** The provider's event time (seconds). */
    created: v.optional(v.number()),
    processedAt: v.number(),
  }).index("by_event_id", ["eventId"]),

  /**
   * The Polar product behind each of the 14 things Folevi sells (`key`: "personal_core_monthly",
   * "workspace_pro_ai_yearly", "credits_500"…), per Polar server (sandbox or production), with the
   * catalog settings it was created or matched with. Written only from Admin → Billing setup
   * (convex/billingSetup.ts). Checkout reads the id here first and falls back to the POLAR_PRODUCT_* env var.
   */
  billingProducts: defineTable({
    key: v.string(),
    server: v.union(v.literal("sandbox"), v.literal("production")),
    polarProductId: v.string(),
    /** created: made by Billing setup; matched: found in Polar by its metadata or name; pinned: used although it differs. */
    source: v.union(v.literal("created"), v.literal("matched"), v.literal("pinned")),
    name: v.string(),
    type: v.union(v.literal("recurring"), v.literal("one_time")),
    priceCents: v.number(),
    currency: v.string(),
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
    seatBased: v.boolean(),
    /** For a pinned product: how it differs from the catalog, as shown to the admin who pinned it. */
    differences: v.optional(v.array(v.string())),
    createdAt: v.number(),
    createdBy: v.id("profiles"),
  }).index("by_server_key", ["server", "key"]),

  /**
   * AI use per person per day (UTC), per scope, for the credits meter and analytics. No content: never a
   * prompt, a note or an answer. `count` is requests; credits and tokens were added with AI credits.
   */
  aiUsage: defineTable({
    profileId: v.id("profiles"),
    day: v.string(),
    count: v.number(),
    scope: v.union(v.literal("personal"), v.literal("workspace")),
    /** The team workspace the requests were made in (scope "workspace"). */
    workspaceId: v.optional(v.id("workspaces")),
    /** Credits charged (after rounding up per request). */
    credits: v.optional(v.number()),
    /** Tokens sent (prompt) and generated (answer plus thinking), from Gemini's usage metadata. */
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
  })
    .index("by_profile_day", ["profileId", "day"])
    .index("by_day", ["day"])
    .index("by_workspace_day", ["workspaceId", "day"]),

  /**
   * AI credits used per credit account per period (lib/credits.ts). An account is a person in Personal
   * (workspaceId unset; also used in free workspaces and by guests) or a member's seat in a paid workspace.
   * A new period is a new row, which is how monthly credits reset.
   */
  aiCreditPeriods: defineTable({
    profileId: v.id("profiles"),
    workspaceId: v.optional(v.id("workspaces")),
    /** The period's start (ms); for the trial, the trial's own row (periodKey "trial"). */
    periodKey: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    /** Monthly credits used (never more than the allowance). */
    used: v.number(),
    /** Credits a request cost beyond everything available (clamped to zero, not charged). */
    overrun: v.optional(v.number()),
    /** Credits charged this period (monthly and extra) by feature, and by UTC day (lib/ai/usage.ts). */
    features: v.optional(v.record(v.string(), v.number())),
    days: v.optional(v.record(v.string(), v.number())),
    updatedAt: v.number(),
  }).index("by_account_period", ["profileId", "workspaceId", "periodKey"]),

  /**
   * Bought and granted AI credits: a pack (Polar order), a test purchase, or an admin grant. Belongs to one
   * credit account; used oldest-expiring first after the monthly credits; lasts 12 months (grants: as set).
   */
  aiCreditPacks: defineTable({
    profileId: v.id("profiles"),
    workspaceId: v.optional(v.id("workspaces")),
    credits: v.number(),
    remaining: v.number(),
    source: v.union(v.literal("polar"), v.literal("test"), v.literal("admin")),
    status: v.union(v.literal("active"), v.literal("refunded")),
    purchasedAt: v.number(),
    expiresAt: v.number(),
    /** Credits a refund of this pack's order has taken back so far (used credits stay used). */
    refundedCredits: v.optional(v.number()),
    /** Polar order id (packs), for refunds and exactly-once delivery. */
    orderId: v.optional(v.string()),
    paymentId: v.optional(v.id("payments")),
  })
    .index("by_account_expires", ["profileId", "workspaceId", "expiresAt"])
    .index("by_order", ["orderId"]),

  /**
   * Credits set aside while an AI request runs (the estimate), so parallel requests can't spend the same
   * credits. Released when the request settles; an expired hold no longer counts.
   */
  aiCreditHolds: defineTable({
    profileId: v.id("profiles"),
    workspaceId: v.optional(v.id("workspaces")),
    /** The scope the request was made in (for aiUsage), which can differ from the account's. */
    scope: v.union(v.literal("personal"), v.literal("workspace")),
    scopeWorkspaceId: v.optional(v.id("workspaces")),
    credits: v.number(),
    /** What the request is for (lib/ai/usage.ts), counted when it settles. */
    feature: v.optional(vAiFeature),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_account", ["profileId", "workspaceId"])
    .index("by_expires", ["expiresAt"]),

  /**
   * Storage used per member in a team workspace (bytes), for per-person quotas on paid plans. The
   * workspace's total stays on `workspaces.storageUsedBytes`. Files record who they count against
   * (`files.chargedTo`).
   */
  workspaceStorage: defineTable({
    workspaceId: v.id("workspaces"),
    profileId: v.id("profiles"),
    usedBytes: v.number(),
  }).index("by_workspace_profile", ["workspaceId", "profileId"]),

  /**
   * Live AI output while it's being written (convex/ai.ts, and chat answers in aiChat.ts), so the app can
   * show it word by word. Holds only the AI's reply (never the prompt or the notes sent), readable only by
   * its owner, and deleted shortly after it finishes (plus an hourly sweep for anything left behind).
   */
  aiStreams: defineTable({
    profileId: v.id("profiles"),
    text: v.string(),
    status: v.union(v.literal("pending"), v.literal("streaming"), v.literal("done"), v.literal("error"), v.literal("cancelled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_created", ["createdAt"]),

  /**
   * AI conversations (convex/aiChat.ts): private to the person who started them (`profileId`), in the
   * scope they were started in, unless they share one with their workspace (read-only, aiSharing.ts).
   * Deleted with the account, the workspace, or by the person. With history off (profiles.aiHistory) a
   * conversation is `ephemeral`: deleted when its chat closes, and swept after a day.
   */
  aiConversations: defineTable({
    publicId: v.string(),
    ...scoped,
    profileId: v.id("profiles"),
    title: v.string(),
    /** The title was written (from the first exchange, or renamed); unset while it's still "New chat". */
    titled: v.optional(v.boolean()),
    pinned: v.boolean(),
    /** What the conversation is about: notes, a folder, or the whole scope (public ids). */
    context: vAiContext,
    model: v.optional(v.string()),
    /**
     * "workspace": shared read-only with the workspace's members (convex/aiSharing.ts). A member sees it
     * only while they can open every note in `noteRefs`, checked on every read.
     */
    sharedWith: v.union(v.literal("none"), v.literal("workspace")),
    sharedAt: v.optional(v.number()),
    /** While shared: every note the conversation cites, is about or used (public ids, capped). */
    noteRefs: v.optional(v.array(v.string())),
    ephemeral: v.optional(v.boolean()),
    /** The title and messages, lowercased and capped, for the conversation list's search. */
    searchText: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.number(),
  })
    .index("by_public_id", ["publicId"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_profile_place", ["profileId", "workspaceId", "pinned", "lastMessageAt"])
    .index("by_ephemeral_updated", ["ephemeral", "updatedAt"])
    .index("by_workspace_shared", ["workspaceId", "sharedWith", "lastMessageAt"])
    .searchIndex("search", { searchField: "searchText", filterFields: ["profileId", "workspaceId"] }),

  /**
   * Messages in an AI conversation. An assistant message is written as the answer streams (status
   * "streaming", throttled), then settled ("done", "stopped" or "error"). Citations point at notes (and a
   * block when one matched); proposed changes are applied only when the person applies them.
   */
  aiMessages: defineTable({
    ...scoped,
    conversationId: v.id("aiConversations"),
    profileId: v.id("profiles"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("tool")),
    text: v.string(),
    citations: v.optional(
      v.array(v.object({ n: v.number(), noteId: v.string(), title: v.string(), blockId: v.optional(v.string()), quote: v.optional(v.string()) })),
    ),
    /** Web pages the answer cited (web research), numbered after the notes. */
    webCitations: v.optional(v.array(v.object({ n: v.number(), url: v.string(), title: v.string(), domain: v.string() }))),
    /**
     * Google's Search Suggestions chips (grounding searchEntryPoint.renderedContent, at most 32 KB together),
     * shown with a grounded answer as Google's terms require, only ever in a sandboxed frame.
     */
    searchEntryPoints: v.optional(v.array(v.string())),
    actions: v.optional(v.array(vAiAction)),
    /** What became of the proposed changes. */
    actionsOutcome: v.optional(
      v.union(
        v.object({ kind: v.literal("dismissed") }),
        v.object({ kind: v.literal("applied"), folders: v.array(v.object({ id: v.string(), name: v.string() })), notes: v.array(v.object({ id: v.string(), title: v.string() })), moved: v.number() }),
      ),
    ),
    /** Tool calls and their results (later milestones), results truncated. */
    toolCalls: v.optional(v.array(v.object({ name: v.string(), args: v.string(), result: v.optional(v.string()) }))),
    attachments: v.optional(v.array(v.id("files"))),
    /** Short follow-up questions offered under an answer. */
    suggestions: v.optional(v.array(v.string())),
    status: v.union(v.literal("streaming"), v.literal("done"), v.literal("stopped"), v.literal("error")),
    /** What the assistant is doing while it works ("searching", "reading", "writing"). */
    phase: v.optional(v.string()),
    error: v.optional(v.object({ code: v.string(), message: v.string(), action: v.optional(v.string()), reason: v.optional(v.string()) })),
    usage: v.optional(v.object({ credits: v.number(), tokensIn: v.number(), tokensOut: v.number() })),
    /**
     * While the answer streams, its text so far lives in this aiStreams row (aiChat.streamText), so the
     * conversation's query isn't re-run on every chunk; the text comes back here when it settles.
     */
    streamId: v.optional(v.id("aiStreams")),
    /** An agent run's answer (convex/aiAgent.ts): the steps it took, and its proposed changes (aiRuns). */
    agent: v.optional(v.object({ steps: v.array(v.object({ tool: v.string(), count: v.number(), ok: v.boolean() })), runId: v.optional(v.id("aiRuns")) })),
    /** A preference the answer offers to remember (lib/ai/memory.ts): saved only when the person clicks Save. */
    memory: v.optional(v.object({ kind: vMemoryKind, text: v.string(), status: v.union(v.literal("proposed"), v.literal("saved"), v.literal("dismissed")) })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerProfileId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_conversation", ["conversationId", "createdAt"])
    .index("by_profile", ["profileId"])
    .index("by_status_updated", ["status", "updatedAt"]),

  /**
   * An agent run's proposed changes (convex/aiAgent.ts, docs/AI_ASSISTANT.md "Tools and the agent"):
   * private to the person who asked, in the conversation's scope. Nothing in `operations` happens until
   * they approve it; executing saves a version of each note first (`notes`, documentSnapshots "ai_run")
   * and keeps what Undo needs on each operation. Deleted with its conversation, the account or workspace.
   */
  aiRuns: defineTable({
    publicId: v.string(),
    ...scoped,
    profileId: v.id("profiles"),
    conversationId: v.id("aiConversations"),
    messageId: v.id("aiMessages"),
    status: vRunStatus,
    operations: v.array(vAgentOp),
    notes: v.array(vRunNote),
    /** Undo found parts changed since (not undone until the person confirms). */
    changed: v.optional(v.array(v.object({ key: v.string(), label: v.string() }))),
    createdAt: v.number(),
    updatedAt: v.number(),
    executedAt: v.optional(v.number()),
    undoneAt: v.optional(v.number()),
  })
    .index("by_public_id", ["publicId"])
    .index("by_conversation", ["conversationId"])
    .index("by_profile", ["profileId"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_workspace", ["workspaceId"]),

  /**
   * Deep research jobs (convex/aiResearch.ts, docs/AI_ASSISTANT.md milestone 6): private to the person who
   * asked, in the conversation's scope. The report is written into the conversation's message
   * (`messageId`); the job keeps its steps, sources, cost and the note it was saved as. Credits are held
   * up front (`holdId`) and settled when it ends. Deleted with its conversation, the account or workspace.
   */
  aiResearch: defineTable({
    publicId: v.string(),
    ...scoped,
    profileId: v.id("profiles"),
    conversationId: v.id("aiConversations"),
    messageId: v.id("aiMessages"),
    question: v.string(),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("cancelled")),
    steps: v.array(vResearchStep),
    holdId: v.optional(v.id("aiCreditHolds")),
    sources: v.optional(v.array(vReportSource)),
    /** The note the report was saved as (public id). */
    noteId: v.optional(v.string()),
    error: v.optional(v.object({ code: v.string(), message: v.string(), action: v.optional(v.string()), reason: v.optional(v.string()) })),
    usage: v.optional(v.object({ credits: v.number(), tokensIn: v.number(), tokensOut: v.number() })),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_public_id", ["publicId"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_profile", ["profileId"])
    .index("by_profile_place", ["profileId", "workspaceId", "createdAt"])
    .index("by_conversation", ["conversationId"])
    .index("by_message", ["messageId"])
    .index("by_status_updated", ["status", "updatedAt"]),

  /**
   * Semantic search (convex/aiIndex.ts, docs/AI_ASSISTANT.md "Retrieval"): a note's text in chunks of about
   * 1,000 characters, each with its embedding, for Pro, Pro AI and paid team workspaces only. Derived from
   * the note (never a source of truth): rebuilt when it changes, removed when it's trashed, deleted or out
   * of plan. Search always re-checks the person can open the note; the scope filter is never enough.
   */
  aiChunks: defineTable({
    documentId: v.id("documents"),
    ...scoped,
    chunkIndex: v.number(),
    text: v.string(),
    /** The blocks the chunk's text came from, in order (citations open the note at them). */
    blockIds: v.array(v.string()),
    /** What was embedded (title, text and model); a chunk with the same hash keeps its embedding. */
    contentHash: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    indexedAt: v.number(),
  })
    .index("by_document", ["documentId", "chunkIndex"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 768, filterFields: ["ownerProfileId", "workspaceId"] }),

  /**
   * Where each note's chunks are (convex/aiIndex.ts): the contentSeq they were built from, and whether an
   * index job is waiting (`dueAt`), so edits schedule at most one job at a time.
   */
  aiIndexState: defineTable({
    documentId: v.id("documents"),
    ...scoped,
    /** The note's contentSeq the chunks match (-1: none yet, or removed). */
    indexedContentSeq: v.number(),
    chunks: v.number(),
    embeddingModel: v.optional(v.string()),
    /** A job is scheduled for then; unset while none is. */
    dueAt: v.optional(v.number()),
    /** When the waiting job was first asked for (edits keep pushing it back, up to a limit). */
    queuedAt: v.optional(v.number()),
    /** Failed embedding attempts in a row (retried a few times, then left for the next edit). */
    failures: v.optional(v.number()),
    indexedAt: v.optional(v.number()),
  })
    .index("by_document", ["documentId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  /** Semantic search per account (a Personal or a workspace): backfilling, ready, or removing its chunks. */
  aiIndexScopes: defineTable({
    ...scoped,
    status: v.union(v.literal("backfilling"), v.literal("ready"), v.literal("removing"), v.literal("off")),
    /** The backfill's place in the scope's notes. */
    cursor: v.optional(v.union(v.string(), v.null())),
    /** When the plan was last checked (the daily sweep). */
    checkedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_status", ["status", "checkedAt"]),

  /**
   * The knowledge graph (convex/aiGraph.ts, docs/AI_ASSISTANT.md "Knowledge graph"): entities found in
   * notes of eligible scopes (the same rule as semantic search). Derived from notes, never a source of
   * truth: rebuilt when a note changes, removed with it. One row per name per scope (`normalized`).
   */
  aiEntities: defineTable({
    ...scoped,
    name: v.string(),
    normalized: v.string(),
    kind: v.union(v.literal("person"), v.literal("project"), v.literal("organization"), v.literal("topic"), v.literal("decision")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // The scope's entities by name (lookups when a note is read, and the whole scope for the graph view).
    .index("by_workspace", ["workspaceId", "normalized"])
    .index("by_owner", ["ownerProfileId", "normalized"]),

  /** Where an entity is mentioned: one row per note, with the blocks it came from. */
  aiMentions: defineTable({
    ...scoped,
    entityId: v.id("aiEntities"),
    documentId: v.id("documents"),
    blockIds: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_entity", ["entityId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  /**
   * Inferred relations (explicit links stay in `documentLinks` and are never copied here): between two
   * entities, or from a note's block to another note's block, found when `sourceDocumentId` was read.
   * "similar" comes from embeddings and carries a `score`; the rest come from the model.
   */
  aiRelations: defineTable({
    ...scoped,
    kind: v.union(v.literal("references"), v.literal("related"), v.literal("contradicts"), v.literal("supersedes"), v.literal("similar")),
    inferred: v.boolean(),
    sourceDocumentId: v.id("documents"),
    sourceBlockId: v.optional(v.string()),
    fromEntityId: v.optional(v.id("aiEntities")),
    toEntityId: v.optional(v.id("aiEntities")),
    toDocumentId: v.optional(v.id("documents")),
    targetBlockId: v.optional(v.string()),
    /** Keys of the two blocks' text when it was found (lib/ai/graph.ts textKey): an edit to either retires it. */
    sourceKey: v.optional(v.string()),
    targetKey: v.optional(v.string()),
    score: v.optional(v.number()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_source", ["sourceDocumentId"])
    .index("by_to_document", ["toDocumentId"])
    // A scope's relations of one kind, closest first for "similar" (duplicates, contradictions).
    .index("by_workspace", ["workspaceId", "kind", "score"])
    .index("by_owner", ["ownerProfileId", "kind", "score"]),

  /** What each note's graph was built from (its content hash), so an unchanged note isn't read again. */
  aiGraphState: defineTable({
    documentId: v.id("documents"),
    ...scoped,
    contentHash: v.string(),
    entities: v.number(),
    extractedAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  /**
   * Memory (convex/aiMemory.ts, lib/ai/memory.ts): preferences a person approved, added to their AI prompts
   * while Settings > AI "Memory" is on. Private to `profileId`. An entry in their Personal applies
   * everywhere they use AI; one in a workspace only there. Only ever written by the person (Settings, or
   * Save on a chat's suggestion). Deleted by them, or with the account or the workspace.
   */
  aiMemories: defineTable({
    ...scoped,
    profileId: v.id("profiles"),
    kind: vMemoryKind,
    text: v.string(),
    source: v.union(v.literal("settings"), v.literal("chat")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_profile", ["profileId", "ownerProfileId", "workspaceId"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_workspace", ["workspaceId"]),

  /**
   * Suggestions a person dismissed on a note (convex/aiSuggestions.ts), by suggestion key, so they don't
   * come back. Scoped like the note; deleted with it, the account or the workspace.
   */
  aiSuggestionDismissals: defineTable({
    ...scoped,
    profileId: v.id("profiles"),
    documentId: v.id("documents"),
    key: v.string(),
    createdAt: v.number(),
  })
    .index("by_profile_document", ["profileId", "documentId", "key"])
    .index("by_document", ["documentId"])
    .index("by_profile", ["profileId"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_workspace", ["workspaceId"]),

  /**
   * A person's AI digest schedule (convex/aiDigest.ts): daily or weekly at an hour of their day, about
   * their Personal or a workspace they're in (`contextWorkspaceId`). `nextAt` is when it's next due (unset
   * while digests are off). Each digest is a note in their Inbox there, plus an in-app notification.
   */
  aiDigests: defineTable({
    profileId: v.id("profiles"),
    frequency: v.union(v.literal("daily"), v.literal("weekly")),
    /** Hour of the day (0 to 23) in the person's time zone. */
    hour: v.number(),
    /** Day of the week for weekly ones (0 Sunday to 6 Saturday). */
    weekday: v.number(),
    contextWorkspaceId: v.optional(v.id("workspaces")),
    nextAt: v.optional(v.number()),
    /** Until when the last digest covered (the next one starts there). */
    lastAt: v.optional(v.number()),
    lastDocumentId: v.optional(v.id("documents")),
    /** Why the last one was skipped (told once per reason, not every time). */
    lastSkip: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_next", ["nextAt"])
    .index("by_context", ["contextWorkspaceId"]),

  tasks: defineTable({
    blockId: v.string(),
    blockDocId: v.id("blocks"),
    documentId: v.id("documents"),
    ...scoped,
    title: v.string(),
    status: v.union(v.literal("open"), v.literal("done"), v.literal("canceled")),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    priority: v.union(v.literal("none"), v.literal("low"), v.literal("medium"), v.literal("high")),
    assigneeId: v.optional(v.id("profiles")),
    reminderAt: v.optional(v.number()),
    reminderSentAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdBy: v.id("profiles"),
    updatedAt: v.number(),
    documentInTrash: v.boolean(),
  })
    .index("by_block", ["blockId"])
    .index("by_document", ["documentId"])
    .index("by_workspace_status_due", ["workspaceId", "status", "dueDate"])
    .index("by_workspace_status_completed", ["workspaceId", "status", "completedAt"])
    .index("by_owner_status_due", ["ownerProfileId", "status", "dueDate"])
    .index("by_owner_status_completed", ["ownerProfileId", "status", "completedAt"])
    .index("by_assignee_status", ["assigneeId", "status"])
    .index("by_reminder", ["reminderAt"])
    // Reminders still to send (processReminders): open, on a page not in Trash, not sent yet.
    .index("by_reminder_pending", ["status", "documentInTrash", "reminderSentAt", "reminderAt"]),

  collections: defineTable({
    publicId: v.string(),
    ...scoped,
    documentId: v.id("documents"),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    seq: v.number(),
  })
    .index("by_public_id", ["publicId"])
    .index("by_document", ["documentId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  collectionProperties: defineTable({
    publicId: v.string(),
    collectionId: v.id("collections"),
    name: v.string(),
    type: vCollectionPropertyType,
    options: v.array(v.object({ id: v.string(), name: v.string(), color: v.string() })),
    rank: v.string(),
    createdAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_collection", ["collectionId"])
    .index("by_public_id", ["publicId"]),

  collectionRows: defineTable({
    publicId: v.string(),
    collectionId: v.id("collections"),
    documentId: v.id("documents"),
    rank: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_collection", ["collectionId"])
    .index("by_document", ["documentId"])
    .index("by_public_id", ["publicId"]),

  collectionValues: defineTable({
    rowId: v.id("collectionRows"),
    propertyId: v.id("collectionProperties"),
    collectionId: v.id("collections"),
    value: v.any(),
    updatedAt: v.number(),
  })
    .index("by_row", ["rowId"])
    .index("by_row_property", ["rowId", "propertyId"])
    .index("by_property", ["propertyId"]),

  collectionViews: defineTable({
    publicId: v.string(),
    collectionId: v.id("collections"),
    name: v.string(),
    type: vCollectionViewType,
    config: v.object({
      filters: v.array(
        v.object({
          propertyId: v.string(),
          op: v.union(
            v.literal("is"),
            v.literal("isNot"),
            v.literal("contains"),
            v.literal("isEmpty"),
            v.literal("isNotEmpty"),
            v.literal("gt"),
            v.literal("lt"),
            v.literal("checked"),
            v.literal("unchecked"),
          ),
          value: v.optional(v.any()),
        }),
      ),
      sorts: v.array(v.object({ propertyId: v.string(), direction: v.union(v.literal("asc"), v.literal("desc")) })),
      groupBy: v.optional(v.string()),
      visibleProperties: v.array(v.string()),
      cardPreview: v.union(v.literal("none"), v.literal("cover"), v.literal("content")),
      cardSize: v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
    }),
    rank: v.string(),
    createdAt: v.number(),
  })
    .index("by_collection", ["collectionId"])
    .index("by_public_id", ["publicId"]),

  commentThreads: defineTable({
    publicId: v.string(),
    ...scoped,
    documentId: v.id("documents"),
    blockId: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdBy: v.id("profiles"),
    createdAt: v.number(),
    lastActivityAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("profiles")),
    commentCount: v.number(),
  })
    .index("by_document", ["documentId", "lastActivityAt"])
    .index("by_public_id", ["publicId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  comments: defineTable({
    publicId: v.string(),
    threadId: v.id("commentThreads"),
    ...scoped,
    documentId: v.id("documents"),
    authorId: v.id("profiles"),
    body: v.any(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_thread", ["threadId", "createdAt"])
    .index("by_public_id", ["publicId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  readStates: defineTable({
    profileId: v.id("profiles"),
    threadId: v.id("commentThreads"),
    documentId: v.id("documents"),
    lastReadAt: v.number(),
  })
    .index("by_profile_thread", ["profileId", "threadId"])
    // By page (cleanup), and one reader's states on a page (comments.threads) through the profile suffix.
    .index("by_document", ["documentId", "profileId"])
    .index("by_thread", ["threadId"]),

  /** Page grants (shares and guests), inherited by nested pages. Scoped like the page they're on. */
  documentPermissions: defineTable({
    documentId: v.id("documents"),
    ...scoped,
    profileId: v.id("profiles"),
    role: vShareRole,
    grantedBy: v.id("profiles"),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_profile", ["profileId"])
    .index("by_document_profile", ["documentId", "profileId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  /**
   * A page shared with an email address that has no (verified, active) Folevi account: a guest invitation.
   * It grants nothing and costs nothing until the person signs in with that verified address and accepts
   * it, which creates the `documentPermissions` grant. Scoped like the page it's for.
   */
  pageInvites: defineTable({
    publicId: v.string(),
    documentId: v.id("documents"),
    ...scoped,
    email: v.string(),
    role: vShareRole,
    tokenHash: v.string(),
    invitedBy: v.id("profiles"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
    expiresAt: v.number(),
    createdAt: v.number(),
    acceptedBy: v.optional(v.id("profiles")),
  })
    .index("by_document", ["documentId"])
    .index("by_email", ["email"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_public_id", ["publicId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"])
    // Expiring pending invitations (maintenance.housekeeping).
    .index("by_status_expires", ["status", "expiresAt"]),

  publicLinks: defineTable({
    publicId: v.string(),
    documentId: v.id("documents"),
    ...scoped,
    tokenHash: v.string(),
    tokenHint: v.string(),
    expiresAt: v.optional(v.number()),
    passwordHash: v.optional(v.string()),
    passwordSalt: v.optional(v.string()),
    allowIndexing: v.boolean(),
    createdBy: v.id("profiles"),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    viewCount: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_document", ["documentId"])
    .index("by_public_id", ["publicId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  notifications: defineTable({
    profileId: v.id("profiles"),
    /** The team workspace it happened in (unset for Personal and account notices). */
    workspaceId: v.optional(v.id("workspaces")),
    kind: v.union(
      v.literal("invite"),
      v.literal("mention"),
      v.literal("comment"),
      v.literal("reply"),
      v.literal("share"),
      v.literal("share_change"),
      v.literal("system"),
    ),
    actorId: v.optional(v.id("profiles")),
    documentId: v.optional(v.id("documents")),
    threadId: v.optional(v.id("commentThreads")),
    inviteId: v.optional(v.id("workspaceInvites")),
    /** A page invitation (a page shared with an address that had no account) waiting for this person. */
    pageInviteId: v.optional(v.id("pageInvites")),
    /** A file for the person to download (an export prepared for them). */
    fileId: v.optional(v.string()),
    title: v.string(),
    body: v.optional(v.string()),
    /** The block the event happened on (a mention in the note, a comment thread's block). */
    blockId: v.optional(v.string()),
    /** Public id of the comment that caused it (for jumping to it). */
    commentId: v.optional(v.string()),
    /** How many events were folded into this one (a burst of comments from one person). */
    count: v.optional(v.number()),
    /** Kept only for email (the digest); the person turned this kind off in the bell. Never listed. */
    silent: v.optional(v.boolean()),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
    emailedAt: v.optional(v.number()),
  })
    .index("by_profile_created", ["profileId", "createdAt"])
    .index("by_profile_unread", ["profileId", "readAt"])
    .index("by_thread", ["threadId"])
    .index("by_created", ["createdAt"])
    .index("by_workspace", ["workspaceId"]),

  /** Per-note notification choice: follow (comments on it notify you) or mute (no comment/reply notifications). */
  noteSubscriptions: defineTable({
    profileId: v.id("profiles"),
    documentId: v.id("documents"),
    ...scoped,
    mode: v.union(v.literal("follow"), v.literal("mute")),
    updatedAt: v.number(),
  })
    .index("by_profile_document", ["profileId", "documentId"])
    .index("by_document_mode", ["documentId", "mode"])
    .index("by_profile", ["profileId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  files: defineTable({
    publicId: v.string(),
    storageId: v.id("_storage"),
    /** Whose storage it counts toward: a Personal (avatars always) or a team workspace (logos always). */
    ...scoped,
    documentId: v.optional(v.id("documents")),
    uploadedBy: v.id("profiles"),
    /**
     * Team workspace files: whose per-person storage it counts against (the uploader if a member, else the
     * page's owner). Unset on older files (the uploader). lib/entitlements.ts.
     */
    chargedTo: v.optional(v.id("profiles")),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.string(),
    /**
     * "attachment": a file someone added to an AI chat message (convex/aiAttachments.ts). Only they can
     * open it; it belongs to the conversation it was sent in (`conversationId`) and goes with it.
     */
    kind: v.union(v.literal("image"), v.literal("file"), v.literal("audio"), v.literal("avatar"), v.literal("logo"), v.literal("cover"), v.literal("export"), v.literal("attachment")),
    /** An AI chat attachment: the conversation it was sent in (unset until it's sent). */
    conversationId: v.optional(v.id("aiConversations")),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    /** For a note style image: the page and text colours picked from it (apps/web/src/lib/palette.ts). */
    palette: v.optional(vImagePalette),
    status: v.union(v.literal("ready"), v.literal("rejected"), v.literal("deleted")),
    createdAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_public_id", ["publicId"])
    .index("by_workspace", ["workspaceId", "createdAt"])
    .index("by_owner", ["ownerProfileId", "createdAt"])
    .index("by_document", ["documentId"])
    .index("by_storage", ["storageId"])
    .index("by_kind_created", ["kind", "createdAt"])
    .index("by_kind_conversation", ["kind", "conversationId", "createdAt"]),

  uploadIntents: defineTable({
    profileId: v.id("profiles"),
    ...scoped,
    documentId: v.optional(v.id("documents")),
    kind: v.union(v.literal("image"), v.literal("file"), v.literal("audio"), v.literal("avatar"), v.literal("logo"), v.literal("cover"), v.literal("attachment")),
    filename: v.string(),
    declaredSize: v.number(),
    declaredMime: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_profile", ["profileId", "createdAt"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"])
    .index("by_expires", ["expiresAt"]),

  syncOperations: defineTable({
    opId: v.string(),
    profileId: v.id("profiles"),
    deviceId: v.string(),
    /** The scope of the entity the op touched. */
    ...scoped,
    entityId: v.string(),
    kind: v.string(),
    baseRevision: v.optional(v.union(v.number(), v.null())),
    status: v.union(v.literal("applied"), v.literal("conflict"), v.literal("rejected")),
    resultRevision: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_profile_op", ["profileId", "opId"])
    .index("by_created", ["createdAt"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

  sessionsMirror: defineTable({
    profileId: v.id("profiles"),
    sessionKey: v.string(),
    client: v.union(v.literal("web"), v.literal("mac")),
    label: v.string(),
    userAgentHash: v.optional(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedReason: v.optional(v.string()),
    /** Better Auth session id (not the secret token) so the session list can revoke the real session. */
    authSessionId: v.optional(v.string()),
  })
    .index("by_profile", ["profileId", "lastSeenAt"])
    .index("by_profile_key", ["profileId", "sessionKey"]),

  /** Development/preview only: identity emails captured locally (convex/authEmails.ts). Never written in production. */
  devMailbox: defineTable({
    to: v.string(),
    key: v.string(),
    actionUrl: v.string(),
    createdAt: v.number(),
  })
    .index("by_to", ["to", "createdAt"])
    .index("by_created", ["createdAt"]),

  emailSendAttempts: defineTable({
    templateKey: v.string(),
    /** The provider's reason for a refusal (masked, ≤200 chars), for the admin email log. */
    providerError: v.optional(v.string()),
    category: v.string(),
    recipientHash: v.string(),
    recipientHint: v.string(),
    profileId: v.optional(v.id("profiles")),
    idempotencyKey: v.string(),
    status: v.union(v.literal("queued"), v.literal("accepted"), v.literal("failed"), v.literal("skipped")),
    attempts: v.number(),
    httpStatus: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    environment: v.string(),
    requestId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    resendOf: v.optional(v.id("emailSendAttempts")),
    resendPayload: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
    /**
     * Historical (Loops era, no longer written): the Loops transactional id of a send made before the move
     * to Mailtrap. Kept because production rows still carry it; the admin email log labels such rows "Loops".
     */
    transactionalId: v.optional(v.string()),
    /** Provider message id, when the provider returns one (Mailtrap: message_ids[0]). */
    providerMessageId: v.optional(v.string()),
    /** Which provider handled the send: "mailtrap" or "mailtrap_sandbox" ("loops" on historical rows, no longer written). */
    provider: v.optional(v.string()),
    /** Latest delivery state from signed provider webhooks (delivered, soft_bounced, bounced, spam_complaint, rejected, suspended). */
    deliveryStatus: v.optional(v.string()),
    deliveryUpdatedAt: v.optional(v.number()),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_provider_message", ["providerMessageId"])
    .index("by_created", ["createdAt"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_profile", ["profileId", "createdAt"])
    .index("by_recipient", ["recipientHash", "createdAt"]),

  emailProviderEvents: defineTable({
    webhookId: v.string(),
    eventName: v.string(),
    eventTime: v.number(),
    /** Historical (Loops era, no longer written): the Loops transactional id carried by a Loops webhook event. */
    transactionalId: v.optional(v.string()),
    providerEmailId: v.optional(v.string()),
    recipientHash: v.optional(v.string()),
    receivedAt: v.number(),
    /** The send attempt this event was matched to on receipt (provider message id, else the attempt id the email carries). */
    attemptId: v.optional(v.id("emailSendAttempts")),
    /** "mailtrap" (webhookId is "mailtrap:<event_id>"); unset on historical Loops-era events (no longer written). */
    provider: v.optional(v.string()),
    /** Mailtrap category = our template key. */
    category: v.optional(v.string()),
    /** Bounce details kept for diagnosis: Mailtrap's bounce category and the SMTP code (never the SMTP text). */
    bounceCategory: v.optional(v.string()),
    responseCode: v.optional(v.number()),
  })
    .index("by_webhook_id", ["webhookId"])
    .index("by_attempt", ["attemptId", "eventTime"])
    .index("by_recipient", ["recipientHash", "eventTime"])
    .index("by_received", ["receivedAt"]),

  /**
   * Addresses that hard-bounced, complained or unsubscribed at the provider (keyed by hashRecipient, never
   * the address). Product email is not sent to them; identity/security email still is.
   */
  emailSuppressions: defineTable({
    recipientHash: v.string(),
    reason: v.union(v.literal("hard_bounce"), v.literal("spam_complaint"), v.literal("unsubscribe")),
    provider: v.string(),
    eventId: v.optional(v.string()),
    attemptId: v.optional(v.id("emailSendAttempts")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_recipient", ["recipientHash"]),

  /**
   * Support requests (convex/support.ts, docs/SUPPORT.md): from the support page, the app, or email to
   * support@folevi.com. `number` is the human ticket number ("[Folevi #1042]"), allocated in order. The
   * requester's address is stored lowercased; `profileId` is set only from a signed-in session, never from
   * an address someone typed or an email's From line.
   */
  supportTickets: defineTable({
    number: v.number(),
    requesterEmail: v.string(),
    profileId: v.optional(v.id("profiles")),
    name: v.string(),
    topic: v.string(),
    subject: v.string(),
    status: v.union(v.literal("open"), v.literal("pending"), v.literal("closed")),
    source: v.union(v.literal("web_form"), v.literal("in_app"), v.literal("email")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.number(),
    /** A requester message staff haven't opened yet (drives the admin nav count). */
    unreadForStaff: v.boolean(),
    assigneeId: v.optional(v.id("profiles")),
    closedAt: v.optional(v.number()),
  })
    .index("by_number", ["number"])
    .index("by_last_message", ["lastMessageAt"])
    .index("by_status_last", ["status", "lastMessageAt"])
    .index("by_email_last", ["requesterEmail", "lastMessageAt"])
    .index("by_profile_last", ["profileId", "lastMessageAt"])
    .index("by_unread", ["unreadForStaff", "lastMessageAt"]),

  /** The messages of a support ticket: the requester's, staff replies (emailed) and internal notes (never emailed). */
  supportMessages: defineTable({
    ticketId: v.id("supportTickets"),
    authorKind: v.union(v.literal("requester"), v.literal("staff"), v.literal("note")),
    /** The staff member who wrote a reply or note. */
    staffProfileId: v.optional(v.id("profiles")),
    body: v.string(),
    createdAt: v.number(),
    /** RFC Message-ID of an inbound email (without brackets), for threading and de-duplication. */
    emailMessageId: v.optional(v.string()),
    /** Mailtrap's id of the inbound message (de-duplicates webhook retries). */
    inboundMessageId: v.optional(v.string()),
  })
    .index("by_ticket", ["ticketId", "createdAt"])
    .index("by_email_message", ["emailMessageId"])
    .index("by_inbound_message", ["inboundMessageId"]),

  featureFlags: defineTable({
    key: v.string(),
    enabled: v.boolean(),
    description: v.string(),
    updatedBy: v.optional(v.id("profiles")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  systemSettings: defineTable({
    key: v.string(),
    value: v.any(),
    updatedBy: v.optional(v.id("profiles")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  builtInTemplates: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.string(),
    icon: v.string(),
    enabled: v.boolean(),
    rank: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  rateLimits: defineTable({
    bucket: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index("by_bucket", ["bucket"])
    .index("by_window", ["windowStart"]),

  rateLimitEvents: defineTable({
    rule: v.string(),
    subjectHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_rule_created", ["rule", "createdAt"]),

  adminAuditLogs: defineTable({
    actorId: v.id("profiles"),
    actorRole: vPlatformRole,
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    reason: v.optional(v.string()),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    requestId: v.string(),
    clientHash: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_target", ["targetType", "targetId", "createdAt"])
    .index("by_actor", ["actorId", "createdAt"]),

  deletionJobs: defineTable({
    kind: v.union(v.literal("account"), v.literal("workspace"), v.literal("document")),
    targetId: v.string(),
    requestedBy: v.id("profiles"),
    requestedByAdmin: v.boolean(),
    reason: v.string(),
    scheduledFor: v.number(),
    status: v.union(v.literal("scheduled"), v.literal("running"), v.literal("completed"), v.literal("canceled"), v.literal("failed")),
    progress: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_status_scheduled", ["status", "scheduledFor"])
    .index("by_target", ["kind", "targetId"]),

  /**
   * Progress and result of a resumable data check (migrations.verifyAccountModel): where the job has got to
   * (`stage` + `cursor`) and what it has found so far. Read with migrations.accountModelReport; only the
   * latest few are kept. Counts are name → number (the check's counts changed over time; older reports
   * keep the names they were written with).
   */
  migrationReports: defineTable({
    name: v.string(),
    stage: v.number(),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    /** Set when done: every count is 0. */
    ok: v.optional(v.boolean()),
    counts: v.record(v.string(), v.number()),
    tables: v.record(v.string(), v.record(v.string(), v.number())),
    runs: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_name_started", ["name", "startedAt"]),

  metrics: defineTable({
    key: v.string(),
    value: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  metricsDaily: defineTable({
    date: v.string(),
    key: v.string(),
    value: v.number(),
  })
    .index("by_key_date", ["key", "date"])
    .index("by_date", ["date"]),

  deployments: defineTable({
    environment: v.string(),
    commitSha: v.string(),
    commitMessage: v.string(),
    source: v.string(),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  presence: defineTable({
    documentId: v.id("documents"),
    profileId: v.id("profiles"),
    sessionKey: v.string(),
    focusedBlockId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_document", ["documentId", "updatedAt"])
    .index("by_session", ["sessionKey", "documentId"])
    .index("by_updated", ["updatedAt"]),
});
