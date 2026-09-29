"use client";

import type { ConvexReactClient } from "convex/react";
import { api } from "@/lib/convex/api";
import { sha256Hex } from "@/lib/sync/uploads";

/** Image types the server accepts for profile pictures and workspace logos (it re-checks the bytes). */
export const IDENTITY_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const IDENTITY_IMAGE_ACCEPT = IDENTITY_IMAGE_TYPES.join(",");
export const MAX_IDENTITY_IMAGE_BYTES = 2 * 1024 * 1024;

/** A friendly reason the file can't be used, checked before uploading (the server enforces the same rules). */
export function identityImageProblem(file: File): string | null {
  if (!(IDENTITY_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Choose a PNG, JPEG, WebP or GIF image.";
  if (file.size > MAX_IDENTITY_IMAGE_BYTES) return "Images can be up to 2 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/**
 * Uploads a profile picture ("avatar") or team logo ("logo") and returns the verified file id, ready for
 * `users.setAvatar` / `workspaces.setLogo`. The server decides where the file lives and who may upload it.
 */
export async function uploadIdentityImage(client: ConvexReactClient, input: { kind: "avatar"; file: File } | { kind: "logo"; workspaceId: string; file: File }): Promise<string> {
  const { uploadUrl, intentId } = await client.mutation(api.files.generateUploadUrl, {
    // A profile picture always goes to your Personal; a logo to its team workspace.
    scope: input.kind === "logo" ? { kind: "workspace", workspaceId: input.workspaceId } : undefined,
    filename: input.file.name || "image",
    size: input.file.size,
    mimeType: input.file.type,
    kind: input.kind,
  });
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": input.file.type }, body: input.file });
  if (!res.ok) throw new Error(`The upload failed (${res.status}).`);
  const { storageId } = (await res.json()) as { storageId: string };
  const result = await client.action(api.files.finalize, { intentId, storageId: storageId as never, sha256: await sha256Hex(input.file) });
  return result.fileId;
}
