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
import type * as blocks from "../blocks.js";
import type * as collections from "../collections.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as documents from "../documents.js";
import type * as email from "../email.js";
import type * as exports from "../exports.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as imports from "../imports.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_collections from "../lib/collections.js";
import type * as lib_create from "../lib/create.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_documents from "../lib/documents.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_fileUrls from "../lib/fileUrls.js";
import type * as lib_images from "../lib/images.js";
import type * as lib_metrics from "../lib/metrics.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_seedContent from "../lib/seedContent.js";
import type * as lib_seq from "../lib/seq.js";
import type * as lib_syncEngine from "../lib/syncEngine.js";
import type * as lib_templates from "../lib/templates.js";
import type * as lib_validators from "../lib/validators.js";
import type * as maintenance from "../maintenance.js";
import type * as notifications from "../notifications.js";
import type * as organization from "../organization.js";
import type * as presence from "../presence.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as sharing from "../sharing.js";
import type * as sync from "../sync.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  blocks: typeof blocks;
  collections: typeof collections;
  comments: typeof comments;
  crons: typeof crons;
  documents: typeof documents;
  email: typeof email;
  exports: typeof exports;
  files: typeof files;
  http: typeof http;
  identity: typeof identity;
  imports: typeof imports;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/collections": typeof lib_collections;
  "lib/create": typeof lib_create;
  "lib/crypto": typeof lib_crypto;
  "lib/documents": typeof lib_documents;
  "lib/errors": typeof lib_errors;
  "lib/fileUrls": typeof lib_fileUrls;
  "lib/images": typeof lib_images;
  "lib/metrics": typeof lib_metrics;
  "lib/notify": typeof lib_notify;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/seedContent": typeof lib_seedContent;
  "lib/seq": typeof lib_seq;
  "lib/syncEngine": typeof lib_syncEngine;
  "lib/templates": typeof lib_templates;
  "lib/validators": typeof lib_validators;
  maintenance: typeof maintenance;
  notifications: typeof notifications;
  organization: typeof organization;
  presence: typeof presence;
  search: typeof search;
  seed: typeof seed;
  settings: typeof settings;
  sharing: typeof sharing;
  sync: typeof sync;
  tasks: typeof tasks;
  users: typeof users;
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

export declare const components: {};
