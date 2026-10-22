// The App Links statement for app.folevi.com (app/.well-known/assetlinks.json/route.ts).
const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/** The statement for the fingerprints in FOLEVI_ANDROID_CERT_SHA256 (none: an empty list). */
export function assetLinks(env: string | undefined) {
  const fingerprints = (env ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => FINGERPRINT.test(f));
  if (!fingerprints.length) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: "com.folevi.android", sha256_cert_fingerprints: fingerprints },
    },
  ];
}
