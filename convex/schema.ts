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
  vProfileStatus,
  vShareRole,
  vWorkspaceRole,
} from "./lib/validators";

/**
 * Folevi data model. Every table that holds workspace content carries `workspaceId` so reads can be
 * scoped by membership, and a `seq` stamped from the workspace change counter (see SYNC_PROTOCOL.md).
 * Client-visible identity uses `publicId` (ULID) fields; Convex `_id`s never leave the backend as identity.
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
    defaultWorkspaceId: v.optional(v.id("workspaces")),
    notificationPrefs: v.object({
      mentions: v.boolean(),
      comments: v.boolean(),
      shares: v.boolean(),
      invites: v.boolean(),
      digest: v.union(v.literal("off"), v.literal("daily")),
      productEmail: v.boolean(),
    }),
    createdAt: v.number(),
    lastActiveAt: v.number(),
    deletionScheduledFor: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_platform_role", ["platformRole"])
    .index("by_created", ["createdAt"]),

  workspaces: defineTable({
    publicId: v.string(),
    name: v.string(),
    kind: v.union(v.literal("personal"), v.literal("team")),
    ownerId: v.id("profiles"),
    icon: v.optional(v.string()),
    /** Square logo for team workspaces (a `files` row of kind "logo"). Personal workspaces show the owner's avatar. */
    logoFileId: v.optional(v.id("files")),
    changeSeq: v.number(),
    status: v.union(v.literal("active"), v.literal("suspended"), v.literal("deleting")),
    storageUsedBytes: v.number(),
    storageQuotaBytes: v.number(),
    memberLimit: v.number(),
    documentCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_public_id", ["publicId"])
    .index("by_owner", ["ownerId"])
    .index("by_created", ["createdAt"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    profileId: v.id("profiles"),
    role: vWorkspaceRole,
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
    workspaceId: v.id("workspaces"),
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
    .index("by_public_id", ["publicId"])
    .index("by_parent", ["parentFolderId"]),

  tags: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    name: v.string(),
    normalizedName: v.string(),
    color: v.string(),
    createdAt: v.number(),
    seq: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_name", ["workspaceId", "normalizedName"])
    .index("by_public_id", ["publicId"]),

  documentTags: defineTable({
    workspaceId: v.id("workspaces"),
    documentId: v.id("documents"),
    tagId: v.id("tags"),
  })
    .index("by_document", ["documentId"])
    .index("by_tag", ["tagId"]),

  documents: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
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
    .index("by_collection", ["collectionId"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["workspaceId", "inTrash", "folderId", "createdBy", "kind"],
    })
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["workspaceId", "inTrash"],
    }),

  documentLinks: defineTable({
    workspaceId: v.id("workspaces"),
    sourceDocumentId: v.id("documents"),
    targetPublicId: v.string(),
    blockId: v.string(),
  })
    .index("by_target", ["targetPublicId"])
    .index("by_source_block", ["sourceDocumentId", "blockId"])
    .index("by_source", ["sourceDocumentId"]),

  stars: defineTable({
    profileId: v.id("profiles"),
    documentId: v.id("documents"),
    workspaceId: v.id("workspaces"),
    createdAt: v.number(),
  })
    .index("by_profile", ["profileId", "createdAt"])
    .index("by_profile_document", ["profileId", "documentId"])
    .index("by_document", ["documentId"]),

  recents: defineTable({
    profileId: v.id("profiles"),
    documentId: v.id("documents"),
    workspaceId: v.id("workspaces"),
    viewedAt: v.number(),
  })
    .index("by_profile_viewed", ["profileId", "viewedAt"])
    .index("by_profile_document", ["profileId", "documentId"])
    .index("by_document", ["documentId"]),

  blocks: defineTable({
    blockId: v.string(),
    documentId: v.id("documents"),
    workspaceId: v.id("workspaces"),
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
    .index("by_workspace_seq", ["workspaceId", "seq"]),

  documentSnapshots: defineTable({
    documentId: v.id("documents"),
    workspaceId: v.id("workspaces"),
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
    .index("by_storage", ["storageId"]),

  snapshotChunks: defineTable({
    snapshotId: v.id("documentSnapshots"),
    index: v.number(),
    data: v.string(),
  }).index("by_snapshot", ["snapshotId", "index"]),

  /**
   * Each person's plan (one row per profile; see convex/lib/plans.ts for what plans include). Created at
   * sign-up with a 7-day Pro trial. Paid plans come from the payment provider (Stripe webhooks) or are set
   * by an admin ("manual"); admins can also grant AI or override storage.
   */
  subscriptions: defineTable({
    profileId: v.id("profiles"),
    plan: v.union(v.literal("free"), v.literal("basic"), v.literal("pro")),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_plan", ["plan"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  /** Money received (and refunds), for billing history and revenue analytics. Amounts in cents. */
  payments: defineTable({
    profileId: v.id("profiles"),
    amountCents: v.number(),
    currency: v.string(),
    plan: v.union(v.literal("basic"), v.literal("pro")),
    interval: v.union(v.literal("month"), v.literal("year")),
    status: v.union(v.literal("paid"), v.literal("refunded"), v.literal("failed")),
    provider: v.union(v.literal("stripe"), v.literal("manual"), v.literal("test")),
    providerRef: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_profile_created", ["profileId", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_provider_ref", ["providerRef"]),

  /** AI requests per person per day (UTC), for usage limits and analytics. No content. */
  aiUsage: defineTable({
    profileId: v.id("profiles"),
    day: v.string(),
    count: v.number(),
  })
    .index("by_profile_day", ["profileId", "day"])
    .index("by_day", ["day"]),

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
    workspaceId: v.id("workspaces"),
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
    .index("by_assignee_status", ["assigneeId", "status"])
    .index("by_reminder", ["reminderAt"]),

  collections: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    documentId: v.id("documents"),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    seq: v.number(),
  })
    .index("by_public_id", ["publicId"])
    .index("by_document", ["documentId"])
    .index("by_workspace", ["workspaceId"]),

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
    workspaceId: v.id("workspaces"),
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
    .index("by_public_id", ["publicId"]),

  comments: defineTable({
    publicId: v.string(),
    threadId: v.id("commentThreads"),
    workspaceId: v.id("workspaces"),
    documentId: v.id("documents"),
    authorId: v.id("profiles"),
    body: v.any(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_thread", ["threadId", "createdAt"])
    .index("by_public_id", ["publicId"]),

  readStates: defineTable({
    profileId: v.id("profiles"),
    threadId: v.id("commentThreads"),
    documentId: v.id("documents"),
    lastReadAt: v.number(),
  })
    .index("by_profile_thread", ["profileId", "threadId"])
    .index("by_profile_document", ["profileId", "documentId"]),

  documentPermissions: defineTable({
    documentId: v.id("documents"),
    workspaceId: v.id("workspaces"),
    profileId: v.id("profiles"),
    role: vShareRole,
    grantedBy: v.id("profiles"),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_profile", ["profileId"])
    .index("by_document_profile", ["documentId", "profileId"]),

  publicLinks: defineTable({
    publicId: v.string(),
    documentId: v.id("documents"),
    workspaceId: v.id("workspaces"),
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
    .index("by_public_id", ["publicId"]),

  notifications: defineTable({
    profileId: v.id("profiles"),
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
    /** A file for the person to download (an export prepared for them). */
    fileId: v.optional(v.string()),
    title: v.string(),
    body: v.optional(v.string()),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
    emailedAt: v.optional(v.number()),
  })
    .index("by_profile_created", ["profileId", "createdAt"])
    .index("by_profile_unread", ["profileId", "readAt"])
    .index("by_created", ["createdAt"]),

  files: defineTable({
    publicId: v.string(),
    storageId: v.id("_storage"),
    workspaceId: v.id("workspaces"),
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
    .index("by_document", ["documentId"])
    .index("by_storage", ["storageId"])
    .index("by_kind_created", ["kind", "createdAt"]),

  uploadIntents: defineTable({
    profileId: v.id("profiles"),
    workspaceId: v.id("workspaces"),
    documentId: v.optional(v.id("documents")),
    kind: v.union(v.literal("image"), v.literal("file"), v.literal("avatar"), v.literal("logo"), v.literal("cover")),
    filename: v.string(),
    declaredSize: v.number(),
    declaredMime: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  }).index("by_profile", ["profileId", "createdAt"]),

  syncOperations: defineTable({
    opId: v.string(),
    profileId: v.id("profiles"),
    deviceId: v.string(),
    workspaceId: v.id("workspaces"),
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
    .index("by_status_created", ["status", "createdAt"]),

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
    /** Loops transactional id (template) used for this send; lets webhook events be matched. */
    transactionalId: v.optional(v.string()),
    /** Provider message id, when the provider returns one. */
    providerMessageId: v.optional(v.string()),
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
  })
    .index("by_webhook_id", ["webhookId"])
    .index("by_attempt", ["attemptId", "eventTime"])
    .index("by_recipient", ["recipientHash", "eventTime"])
    .index("by_received", ["receivedAt"]),

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
