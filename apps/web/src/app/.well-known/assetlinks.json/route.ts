// Android App Links (docs/ANDROID_PLAN.md "Links"): which app may open app.folevi.com's pages, named by its
// package and the SHA-256 fingerprints of the keys that sign it (Play App Signing's key, and the upload key for
// builds installed outside Play). The fingerprints come from FOLEVI_ANDROID_CERT_SHA256 (comma-separated, set
// by the owner on Vercel); without it the list is empty and Android opens these links in the browser.
import { assetLinks } from "@/lib/android/assetLinks";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(assetLinks(process.env.FOLEVI_ANDROID_CERT_SHA256), {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
