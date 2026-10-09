/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminAnalytics from "../adminAnalytics.js";
import type * as adminBilling from "../adminBilling.js";
import type * as ai from "../ai.js";
import type * as aiActions from "../aiActions.js";
import type * as aiAgent from "../aiAgent.js";
import type * as aiChat from "../aiChat.js";
import type * as aiGraph from "../aiGraph.js";
import type * as aiIndex from "../aiIndex.js";
import type * as aiWriting from "../aiWriting.js";
import type * as auth from "../auth.js";
import type * as authEmails from "../authEmails.js";
import type * as billing from "../billing.js";
import type * as billingSetup from "../billingSetup.js";
import type * as blocks from "../blocks.js";
import type * as bookmarks from "../bookmarks.js";
import type * as collections from "../collections.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as digest from "../digest.js";
import type * as documents from "../documents.js";
import type * as email from "../email.js";
import type * as exports from "../exports.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as imports from "../imports.js";
import type * as lib_ai_capabilities from "../lib/ai/capabilities.js";
import type * as lib_ai_chat from "../lib/ai/chat.js";
import type * as lib_ai_gemini from "../lib/ai/gemini.js";
import type * as lib_ai_graph from "../lib/ai/graph.js";
import type * as lib_ai_graphStore from "../lib/ai/graphStore.js";
import type * as lib_ai_indexing from "../lib/ai/indexing.js";
import type * as lib_ai_prefs from "../lib/ai/prefs.js";
import type * as lib_ai_provider from "../lib/ai/provider.js";
import type * as lib_ai_retrieval from "../lib/ai/retrieval.js";
import type * as lib_ai_tools_calculate from "../lib/ai/tools/calculate.js";
import type * as lib_ai_tools_execute from "../lib/ai/tools/execute.js";
import type * as lib_ai_tools_index from "../lib/ai/tools/index.js";
import type * as lib_ai_tools_ops from "../lib/ai/tools/ops.js";
import type * as lib_ai_tools_propose from "../lib/ai/tools/propose.js";
import type * as lib_ai_tools_read from "../lib/ai/tools/read.js";
import type * as lib_ai_tools_related from "../lib/ai/tools/related.js";
import type * as lib_ai_tools_similarity from "../lib/ai/tools/similarity.js";
import type * as lib_ai_tools_untrusted from "../lib/ai/tools/untrusted.js";
import type * as lib_ai_tools_wire from "../lib/ai/tools/wire.js";
import type * as lib_ai_writing from "../lib/ai/writing.js";
import type * as lib_aiActions from "../lib/aiActions.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_authStore from "../lib/authStore.js";
import type * as lib_authors from "../lib/authors.js";
import type * as lib_billing from "../lib/billing.js";
import type * as lib_billingProducts from "../lib/billingProducts.js";
import type * as lib_claims from "../lib/claims.js";
import type * as lib_clientIp from "../lib/clientIp.js";
import type * as lib_collections from "../lib/collections.js";
import type * as lib_create from "../lib/create.js";
import type * as lib_credits from "../lib/credits.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_devices from "../lib/devices.js";
import type * as lib_documents from "../lib/documents.js";
import type * as lib_entitlements from "../lib/entitlements.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_fileUrls from "../lib/fileUrls.js";
import type * as lib_flags from "../lib/flags.js";
import type * as lib_flowchartAi from "../lib/flowchartAi.js";
import type * as lib_folderColors from "../lib/folderColors.js";
import type * as lib_identityImages from "../lib/identityImages.js";
import type * as lib_images from "../lib/images.js";
import type * as lib_linkLabels from "../lib/linkLabels.js";
import type * as lib_metrics from "../lib/metrics.js";
import type * as lib_nativeAuth from "../lib/nativeAuth.js";
import type * as lib_nativeClients from "../lib/nativeClients.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_onboarding from "../lib/onboarding.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_polar from "../lib/polar.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_scope from "../lib/scope.js";
import type * as lib_seats from "../lib/seats.js";
import type * as lib_seedContent from "../lib/seedContent.js";
import type * as lib_seq from "../lib/seq.js";
import type * as lib_support from "../lib/support.js";
import type * as lib_syncEngine from "../lib/syncEngine.js";
import type * as lib_templates from "../lib/templates.js";
import type * as lib_validators from "../lib/validators.js";
import type * as maintenance from "../maintenance.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as organization from "../organization.js";
import type * as presence from "../presence.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as sharing from "../sharing.js";
import type * as support from "../support.js";
import type * as sync from "../sync.js";
import type * as tasks from "../tasks.js";
import type * as testSupport from "../testSupport.js";
import type * as unsplash from "../unsplash.js";
import type * as users from "../users.js";
import type * as workspaceBilling from "../workspaceBilling.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminAnalytics: typeof adminAnalytics;
  adminBilling: typeof adminBilling;
  ai: typeof ai;
  aiActions: typeof aiActions;
  aiAgent: typeof aiAgent;
  aiChat: typeof aiChat;
  aiGraph: typeof aiGraph;
  aiIndex: typeof aiIndex;
  aiWriting: typeof aiWriting;
  auth: typeof auth;
  authEmails: typeof authEmails;
  billing: typeof billing;
  billingSetup: typeof billingSetup;
  blocks: typeof blocks;
  bookmarks: typeof bookmarks;
  collections: typeof collections;
  comments: typeof comments;
  crons: typeof crons;
  digest: typeof digest;
  documents: typeof documents;
  email: typeof email;
  exports: typeof exports;
  files: typeof files;
  http: typeof http;
  identity: typeof identity;
  imports: typeof imports;
  "lib/ai/capabilities": typeof lib_ai_capabilities;
  "lib/ai/chat": typeof lib_ai_chat;
  "lib/ai/gemini": typeof lib_ai_gemini;
  "lib/ai/graph": typeof lib_ai_graph;
  "lib/ai/graphStore": typeof lib_ai_graphStore;
  "lib/ai/indexing": typeof lib_ai_indexing;
  "lib/ai/prefs": typeof lib_ai_prefs;
  "lib/ai/provider": typeof lib_ai_provider;
  "lib/ai/retrieval": typeof lib_ai_retrieval;
  "lib/ai/tools/calculate": typeof lib_ai_tools_calculate;
  "lib/ai/tools/execute": typeof lib_ai_tools_execute;
  "lib/ai/tools/index": typeof lib_ai_tools_index;
  "lib/ai/tools/ops": typeof lib_ai_tools_ops;
  "lib/ai/tools/propose": typeof lib_ai_tools_propose;
  "lib/ai/tools/read": typeof lib_ai_tools_read;
  "lib/ai/tools/related": typeof lib_ai_tools_related;
  "lib/ai/tools/similarity": typeof lib_ai_tools_similarity;
  "lib/ai/tools/untrusted": typeof lib_ai_tools_untrusted;
  "lib/ai/tools/wire": typeof lib_ai_tools_wire;
  "lib/ai/writing": typeof lib_ai_writing;
  "lib/aiActions": typeof lib_aiActions;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/authStore": typeof lib_authStore;
  "lib/authors": typeof lib_authors;
  "lib/billing": typeof lib_billing;
  "lib/billingProducts": typeof lib_billingProducts;
  "lib/claims": typeof lib_claims;
  "lib/clientIp": typeof lib_clientIp;
  "lib/collections": typeof lib_collections;
  "lib/create": typeof lib_create;
  "lib/credits": typeof lib_credits;
  "lib/crypto": typeof lib_crypto;
  "lib/devices": typeof lib_devices;
  "lib/documents": typeof lib_documents;
  "lib/entitlements": typeof lib_entitlements;
  "lib/errors": typeof lib_errors;
  "lib/fileUrls": typeof lib_fileUrls;
  "lib/flags": typeof lib_flags;
  "lib/flowchartAi": typeof lib_flowchartAi;
  "lib/folderColors": typeof lib_folderColors;
  "lib/identityImages": typeof lib_identityImages;
  "lib/images": typeof lib_images;
  "lib/linkLabels": typeof lib_linkLabels;
  "lib/metrics": typeof lib_metrics;
  "lib/nativeAuth": typeof lib_nativeAuth;
  "lib/nativeClients": typeof lib_nativeClients;
  "lib/notify": typeof lib_notify;
  "lib/onboarding": typeof lib_onboarding;
  "lib/permissions": typeof lib_permissions;
  "lib/plans": typeof lib_plans;
  "lib/polar": typeof lib_polar;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/scope": typeof lib_scope;
  "lib/seats": typeof lib_seats;
  "lib/seedContent": typeof lib_seedContent;
  "lib/seq": typeof lib_seq;
  "lib/support": typeof lib_support;
  "lib/syncEngine": typeof lib_syncEngine;
  "lib/templates": typeof lib_templates;
  "lib/validators": typeof lib_validators;
  maintenance: typeof maintenance;
  migrations: typeof migrations;
  notifications: typeof notifications;
  organization: typeof organization;
  presence: typeof presence;
  search: typeof search;
  seed: typeof seed;
  settings: typeof settings;
  sharing: typeof sharing;
  support: typeof support;
  sync: typeof sync;
  tasks: typeof tasks;
  testSupport: typeof testSupport;
  unsplash: typeof unsplash;
  users: typeof users;
  workspaceBilling: typeof workspaceBilling;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
