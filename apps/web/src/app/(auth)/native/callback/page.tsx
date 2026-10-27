import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/fields";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Back to Folevi" };

type Params = Record<string, string | string[] | undefined>;

/**
 * Where Folevi for Android's sign-in returns (an App Link, docs/ANDROID_PLAN.md "Sign-in"). On a phone with the
 * app this address opens the app straight away; this page only shows when the browser didn't hand it over (the
 * link wasn't verified yet, or the person opened it elsewhere). "Open Folevi" asks Chrome for the app by name.
 */
export default async function NativeCallbackPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["code", "state", "error"]) {
    const v = params[key];
    if (typeof v === "string" && v.length <= 512) query.set(key, v);
  }
  const intent = `intent://app.folevi.com/native/callback?${query.toString()}#Intent;scheme=https;package=com.folevi.android;end`;
  return (
    <>
      <AuthHeading title="Back to Folevi" lede="You're signed in. If Folevi didn't open by itself, open it now. You can close this page." />
      <a href={intent} className="ui-btn ui-btn-primary inline-flex h-11 w-full items-center justify-center text-subheadline">
        Open Folevi
      </a>
    </>
  );
}
