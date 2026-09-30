import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";
import { GALLERY_TEMPLATES, type GalleryTemplate } from "./templates";

/** How long the gallery waits for the backend before showing every template. */
const TIMEOUT_MS = 3000;

/**
 * The gallery's templates minus any an admin switched off in the app (settings.disabledBuiltInTemplates).
 * Server only; the gallery pages re-check hourly. If the backend can't be reached (a build without one,
 * an outage), every template is shown: the app still refuses to create one that's switched off.
 */
export async function availableGalleryTemplates(): Promise<GalleryTemplate[]> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return GALLERY_TEMPLATES;
  try {
    const disabled = await Promise.race([
      new ConvexHttpClient(url).query(api.settings.disabledBuiltInTemplates, {}),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    const off = new Set(disabled);
    return GALLERY_TEMPLATES.filter((t) => !off.has(t.key));
  } catch {
    return GALLERY_TEMPLATES;
  }
}
