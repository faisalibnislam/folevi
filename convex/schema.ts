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
  vWorkspacePlanId,
  vWorkspaceRole,
} from "./lib/validators";

/**
 * Where a content row lives: exactly one of these is set (convex/lib/scope.ts).
 *   ownerProfileId — the row is in that person's Personal (Personal is not a workspace);
 *   workspaceId    — the row is in a team workspace.
 * Every insert into a scoped table goes through `insertScoped` (checked by tests/convex/static), and
 * `migrations.verifyAccountModel` reports any row with both or neither.
 */
const scoped = {
  workspaceId: v.optional(v.id("workspaces")),
  ownerProfileId: v.optional(v.id("profiles")),
};

/**
 * Folevi data model. Every table that holds content carries its scope (`scoped` above) so reads can be
 * authorized and listed per scope, and a `seq` stamped from the scope's change counter (a workspace's
 * `changeSeq`, or the owner's `personalChangeSeq`; see SYNC_PROTOCOL.md). Client-visible identity uses
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
    locale: v.string(),
    timeZone: v.string(),
    onboardingStep: v.union(v.literal("workspace"), v.literal("appearance"), v.literal("welcome"), v.literal("done")),
    platformRole: v.optional(vPlatformRole),
    status: vProfileStatus,
    suspendedReason: v.optional(v.string()),
    /** Legacy: the personal workspace of the old model. Cleared by migrations.migratePersonalWorkspaces. */
    defaultWorkspaceId: v.optional(v.id("workspaces")),
    /** Change counter of this person's Personal (unset = 0); `seq` of Personal rows comes from it. */
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

  /** Team workspaces. Rows of kind "personal" are the old model's Personal; the migration removes them. */
  workspaces: defineTable({
    publicId: v.string(),
    name: v.string(),
    kind: v.union(v.literal("personal"), v.literal("team")),
    ownerId: v.id("profiles"),
    icon: v.optional(v.string()),
    /** Square logo (a `files` row of kind "logo", counted in this workspace's storage). */
    logoFileId: v.optional(v.id("files")),
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
    .index("by_kind", ["kind"])
    .index("by_created", ["createdAt"]),

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
    .index("by_public_id", ["publicId"]),

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
    .index("by_block_id", ["blockId"])
    .index("by_workspace_seq", ["workspaceId", "seq"])
    .index("by_owner_seq", ["ownerProfileId", "seq"]),

  documentSnapshots: defineTable({
    documentId: v.id("documents"),
    ...scoped,
    publicId: v.string(),
    reason: v.union(v.literal("idle"), v.literal("close"), v.literal("before_restore"), v.literal("manual"), v.literal("import")),
    title: v.string(),
    content: v.optional(v.string()),
    chunkCount: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    blockCount: v.number(),
    sizeBytes: v.number(),
    contentSeq: v.number(),
    createdBy: v.id("profiles"),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId", "createdAt"])
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
   * Exactly one of `profileId` / `workspaceId` is set, matching `ownerType` (rows from before workspace
   * billing have no `ownerType` and are Personal); rows are written only through convex/lib/billing.ts.
   *
   * Personal rows are created at sign-up with a 7-day Pro trial and store the tier in `plan`. Workspace rows
   * store the catalog id in `planId` and the billed seat count in `quantity`. Paid plans come from the
   * payment provider (Stripe webhooks), a development test purchase ("test"), or an admin ("manual");
   * admins can also grant AI or override storage on Personal plans.
   */
  subscriptions: defineTable({
    /** "user" (Personal) or "workspace"; unset on older rows = "user". */
    ownerType: v.optional(v.union(v.literal("user"), v.literal("workspace"))),
    /** Personal rows: the person. */
    profileId: v.optional(v.id("profiles")),
    /** Workspace rows: the workspace (the plan belongs to it, not to whoever owns it). */
    workspaceId: v.optional(v.id("workspaces")),
    /** Personal rows: the tier. Workspace rows leave it unset (they use planId). */
    plan: v.optional(v.union(v.literal("free"), v.literal("basic"), v.literal("pro"))),
    /** Workspace rows: the catalog plan id (convex/lib/plans.ts). */
    planId: v.optional(vWorkspacePlanId),
    /** Workspace rows: member seats billed (the provider's subscription quantity). */
    quantity: v.optional(v.number()),
    /** Workspace rows: when a seat-quantity sync was scheduled (cleared when it runs; lib/seats.ts). */
    seatSyncScheduledAt: v.optional(v.number()),
    /** Workspace rows: the Stripe subscription item, for seat and plan changes. */
    stripeSubscriptionItemId: v.optional(v.string()),
    /** "Visa •••• 4242", when the provider has told us (workspace rows). */
    paymentMethod: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
    status: v.union(v.literal("active"), v.literal("past_due"), v.literal("canceled")),
    provider: v.union(v.literal("none"), v.literal("stripe"), v.literal("manual"), v.literal("test")),
    trialEndsAt: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    /** Admin-granted AI (on any plan); aiGrantUntil unset = no end date. */
    aiGrant: v.optional(v.boolean()),
    aiGrantUntil: v.optional(v.number()),
    storageOverrideBytes: v.optional(v.number()),
    /** Admin-set device limit (a number, or unlimited); unset = the plan's. */
    deviceLimitOverride: v.optional(v.union(v.number(), v.literal("unlimited"))),
    /** When the current paid plan started (for conversion and churn analytics). */
    paidSince: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    /** Stripe's `created` time (seconds) of the last subscription event applied; older events are ignored. */
    stripeEventCreatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner_type", ["ownerType"])
    .index("by_plan", ["plan"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  /**
   * Money received (and refunds), for billing history and revenue analytics. Amounts in cents. Exactly one
   * of `profileId` (a Personal plan) / `workspaceId` (a workspace plan), so the two histories never mix.
   */
  payments: defineTable({
    profileId: v.optional(v.id("profiles")),
    workspaceId: v.optional(v.id("workspaces")),
    amountCents: v.number(),
    currency: v.string(),
    /** The tier paid for: Personal (basic, pro) or workspace (team, business). */
    plan: v.union(v.literal("basic"), v.literal("pro"), v.literal("team"), v.literal("business")),
    /** Workspace payments: the catalog plan id and the seats billed. */
    planId: v.optional(vWorkspacePlanId),
    quantity: v.optional(v.number()),
    interval: v.union(v.literal("month"), v.literal("year")),
    status: v.union(v.literal("paid"), v.literal("refunded"), v.literal("failed")),
    provider: v.union(v.literal("stripe"), v.literal("manual"), v.literal("test")),
    providerRef: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_profile_created", ["profileId", "createdAt"])
    .index("by_workspace_created", ["workspaceId", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_provider_ref", ["providerRef"]),

  /** Stripe webhook events already applied (by event id), so a redelivered event is applied once. */
  billingEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    /** Stripe's `created` time (seconds). */
    created: v.optional(v.number()),
    processedAt: v.number(),
  }).index("by_event_id", ["eventId"]),

  /**
   * AI requests per person per day (UTC), per scope, for usage limits and analytics. No content. Rows
   * without a scope predate scopes (all were Personal).
   */
  aiUsage: defineTable({
    profileId: v.id("profiles"),
    day: v.string(),
    count: v.number(),
    scope: v.optional(v.union(v.literal("personal"), v.literal("workspace"))),
    /** The team workspace the requests were made in (scope "workspace"). */
    workspaceId: v.optional(v.id("workspaces")),
  })
    .index("by_profile_day", ["profileId", "day"])
    .index("by_day", ["day"])
    .index("by_workspace_day", ["workspaceId", "day"]),

  /**
   * Live AI output while it's being written (convex/ai.ts), so the app can show it word by word. Holds only
   * the AI's reply — never the prompt or the notes sent — readable only by its owner, and deleted shortly
   * after it finishes (plus an hourly sweep for anything left behind).
   */
  aiStreams: defineTable({
    profileId: v.id("profiles"),
    text: v.string(),
    status: v.union(v.literal("pending"), v.literal("streaming"), v.literal("done"), v.literal("error"), v.literal("cancelled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_created", ["createdAt"]),

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
    .index("by_reminder", ["reminderAt"]),

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
    .index("by_profile_document", ["profileId", "documentId"])
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
    .index("by_owner", ["ownerProfileId"]),

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
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.string(),
    kind: v.union(v.literal("image"), v.literal("file"), v.literal("avatar"), v.literal("logo"), v.literal("cover"), v.literal("export")),
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
    .index("by_kind_created", ["kind", "createdAt"]),

  uploadIntents: defineTable({
    profileId: v.id("profiles"),
    ...scoped,
    documentId: v.optional(v.id("documents")),
    kind: v.union(v.literal("image"), v.literal("file"), v.literal("avatar"), v.literal("logo"), v.literal("cover")),
    filename: v.string(),
    declaredSize: v.number(),
    declaredMime: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_profile", ["profileId", "createdAt"])
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerProfileId"]),

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
    /** LEGACY (Loops, remove after cutover): the Loops transactional id used for this send, for webhook matching. */
    transactionalId: v.optional(v.string()),
    /** Provider message id, when the provider returns one (Mailtrap: message_ids[0]). */
    providerMessageId: v.optional(v.string()),
    /** Which provider handled the send: "mailtrap", "mailtrap_sandbox" or (legacy) "loops". */
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
    transactionalId: v.optional(v.string()),
    providerEmailId: v.optional(v.string()),
    recipientHash: v.optional(v.string()),
    receivedAt: v.number(),
    /** The send attempt this event was matched to on receipt (provider id first, then recipient + template + time). */
    attemptId: v.optional(v.id("emailSendAttempts")),
    /** "mailtrap" (webhookId is "mailtrap:<event_id>"); unset for legacy Loops events. */
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
  }).index("by_bucket", ["bucket"]),

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
   * (`stage` + `cursor`) and what it has found so far. Read with migrations.accountModelReport.
   */
  migrationReports: defineTable({
    name: v.string(),
    stage: v.number(),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    /** Set when done: every count is 0. */
    ok: v.optional(v.boolean()),
    counts: v.object({
      rowsWithBothScopes: v.number(),
      rowsWithNoScope: v.number(),
      rowsInLegacyWorkspaces: v.number(),
      rowsOutOfTheirDocumentsScope: v.number(),
      orphanedGrants: v.number(),
      personalWorkspaces: v.number(),
      profilesWithDefaultWorkspace: v.number(),
      legacyRoles: v.number(),
    }),
    tables: v.record(
      v.string(),
      v.object({ rows: v.number(), both: v.number(), neither: v.number(), legacyWorkspace: v.number(), outOfScope: v.number(), orphanedGrants: v.number() }),
    ),
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
    .index("by_session", ["sessionKey", "documentId"]),
});
