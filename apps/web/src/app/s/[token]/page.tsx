import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/lib/convex/api";
import { ReadOnlyBlocks } from "@/components/doc/ReadOnlyBlocks";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { coverBackground } from "@/lib/cover";
import "@/components/editor/editor.css";

export const dynamic = "force-dynamic";

type Result = Awaited<ReturnType<typeof open>>;

async function open(token: string, password?: string) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.FOLEVI_SERVER_SECRET;
  if (!url || !secret) return { status: "unavailable" as const };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const client = new ConvexHttpClient(url);
  try {
    return await client.mutation(api.sharing.openPublicLink, { token, password, serverSecret: secret, clientKey: createHash("sha256").update(ip).digest("hex") });
  } catch (e) {
    const code = (e as { data?: { code?: string } }).data?.code;
    return { status: code === "rate_limited" ? ("rate_limited" as const) : ("unavailable" as const) };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  void params;
  // Shared pages are never indexed and never leak their title into link previews by default.
  return { title: "Shared page", robots: { index: false, follow: false, nocache: true } };
}

const PW_COOKIE = "folevi_share_unlock";

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The password (if any) travels in a short-lived, HTTP-only cookie scoped to this link — never in the URL.
  const jar = await cookies();
  const password = jar.get(PW_COOKIE)?.value;
  const result: Result = await open(token, password || undefined);

  const shell = (children: React.ReactNode) => (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
        <a href={process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com"} className="inline-flex items-center gap-2 text-ink">
          <FoleviMark size={20} accent="var(--color-accent)" />
          <span className="font-display text-xl">Folevi</span>
        </a>
        <span className="text-xs text-muted">Read-only shared page</span>
      </header>
      <main id="main" className="px-3 pb-16 sm:px-6">
        {children}
      </main>
    </div>
  );

  if (result.status === "password_required" || result.status === "password_incorrect") {
    return shell(
      <form
        className="mx-auto mt-16 max-w-sm rounded-[14px] border border-line bg-raised p-6"
        action={async (fd) => {
          "use server";
          const { redirect } = await import("next/navigation");
          const pw = String(fd.get("password") ?? "").slice(0, 200);
          const store = await cookies();
          store.set(PW_COOKIE, pw, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: `/s/${encodeURIComponent(token)}`, maxAge: 60 * 30 });
          redirect(`/s/${encodeURIComponent(token)}`);
        }}
      >
        <h1 className="font-display text-3xl">This page is protected</h1>
        <p className="mt-2 text-sm text-muted">Enter the password the owner gave you.</p>
        {result.status === "password_incorrect" ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            That password isn’t right.
          </p>
        ) : null}
        <label className="mt-4 block text-sm" htmlFor="pw">
          Password
        </label>
        <input id="pw" name="password" type="password" required autoComplete="off" className="mt-1 h-10 w-full rounded-[8px] border border-line bg-surface px-3" />
        <button type="submit" className="mt-4 h-10 w-full rounded-[8px] bg-accent text-sm font-medium text-accent-ink">
          Open page
        </button>
      </form>,
    );
  }
  if (result.status !== "ok") {
    const copy =
      result.status === "expired"
        ? "This link has expired."
        : result.status === "rate_limited"
          ? "Too many requests. Please wait a minute and try again."
          : "This link doesn’t work any more. It may have been revoked.";
    return shell(
      <div className="mx-auto mt-24 max-w-md text-center">
        <h1 className="font-display text-4xl">Page unavailable</h1>
        <p className="mt-3 text-muted">{copy}</p>
      </div>,
    );
  }
  const { document, blocks, fileUrls } = result;
  const bg = coverBackground(document.cover, document.style);
  return shell(
    <article
      className="fb-page fb-sheet mx-auto max-w-[calc(var(--editor-width)+8rem)] rounded-[14px] border border-line"
      data-font={document.style.font}
      data-width={document.style.width}
      data-background={document.style.background}
      style={{ ["--doc-accent" as string]: document.style.accent === "accent" ? "var(--color-accent)" : `var(--color-${document.style.accent})` }}
    >
      {bg ? <div className="h-36 rounded-t-[14px]" style={{ background: bg }} aria-hidden /> : <div className="h-8" />}
      <div className="px-5 pb-6 pt-4 sm:px-16">
        {document.icon ? <div className="text-[40px]" aria-hidden>{document.icon}</div> : null}
        <h1 className={`mt-2 text-[40px] leading-tight ${document.style.font === "serif" ? "font-display" : "font-semibold tracking-tight"}`}>{document.title || "Untitled"}</h1>
        <p className="mb-6 mt-1 text-xs text-muted">Last updated {new Date(document.updatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
        <ReadOnlyBlocks blocks={blocks} fileUrls={fileUrls} />
      </div>
    </article>,
  );
}
