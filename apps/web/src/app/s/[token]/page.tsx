import type { Metadata } from "next";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/convex/api";
import { BlurredBackdrop } from "@/components/doc/BlurredBackdrop";
import { ReadOnlyBlocks } from "@/components/doc/ReadOnlyBlocks";
import { SheetPageBreaks } from "@/components/doc/SheetPageBreaks";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { coverArtOf, coverBackground, pageBackdrop, sheetProps } from "@/lib/cover";
import { setThemeRows, themeFontVars, type ThemeRow } from "@/lib/themes";
import { publishLook, publishTheme, tableOfContents } from "@/lib/publishThemes";
import { formatDate, localeFromAcceptLanguage, tFor } from "@/i18n";
import { currentRequestId, logEvent } from "@/lib/server/log";
import { GRANT_COOKIE, GRANT_TTL_MS, openGrant, sealGrant } from "./grant";
import "@/components/editor/editor.css";
import "@/components/editor/insert-blocks.css";
import "@/components/editor/flowchart/flowchart.css";
import "./publish.css";

export const dynamic = "force-dynamic";

type Result = Awaited<ReturnType<typeof openLink>>;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
const LEGACY_PASSWORD_COOKIE = "folevi_share_unlock";

async function clientKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  // Only a hash of the address leaves this server (Convex uses it for rate limiting).
  return createHash("sha256").update(ip).digest("hex");
}

async function openLink(token: string, password: string | undefined) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.FOLEVI_SERVER_SECRET;
  const requestId = await currentRequestId();
  if (!url || !secret) {
    logEvent("error", "share.open", { requestId, outcome: "not_configured" });
    return { status: "unavailable" as const };
  }
  const client = new ConvexHttpClient(url);
  try {
    const result = await client.mutation(api.sharing.openPublicLink, { token, password, serverSecret: secret, clientKey: await clientKey() });
    logEvent("info", "share.open", { requestId, outcome: result.status });
    return result;
  } catch (e) {
    const code = (e as { data?: { code?: string } }).data?.code;
    logEvent(code === "rate_limited" ? "warn" : "error", "share.open", { requestId, outcome: "error", code: code ?? (e instanceof Error ? e.name : "unknown") });
    return { status: code === "rate_limited" ? ("rate_limited" as const) : ("unavailable" as const) };
  }
}

/**
 * One Convex round trip per request, shared by generateMetadata and the page (opening a link counts a
 * view and is rate limited, so it must not run twice).
 */
const load = cache(async (token: string): Promise<Result> => {
  if (!TOKEN_RE.test(token)) return { status: "not_found" as const };
  const secret = process.env.FOLEVI_SERVER_SECRET ?? "";
  const jar = await cookies();
  const password = secret ? openGrant(jar.get(GRANT_COOKIE)?.value, token, secret) : null;
  return await openLink(token, password ?? undefined);
});

/**
 * The note themes, with the admins' changes and added themes (public data, the same for everyone), so a
 * shared page draws its theme as the app does. Without them it falls back to the shipped themes.
 */
async function loadThemes() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return;
  try {
    setThemeRows((await new ConvexHttpClient(url).query(api.themes.list, {})) as ThemeRow[]);
  } catch {
    // The shipped themes still draw the page.
  }
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const result = await load(token);
  // Shared pages are never indexed and never leak their title into link previews unless the owner
  // allowed indexing for this link (and it isn't password protected).
  if (result.status === "ok" && result.allowIndexing) {
    const title = result.document.title || "Untitled";
    const description = result.description || undefined;
    return { title, description, openGraph: { title, description, type: "article" }, robots: { index: true, follow: false } };
  }
  return { title: "Shared page", robots: { index: false, follow: false, nocache: true } };
}

async function unlock(token: string, formData: FormData) {
  "use server";
  if (!TOKEN_RE.test(token)) redirect("/");
  const password = String(formData.get("password") ?? "").slice(0, 200);
  const secret = process.env.FOLEVI_SERVER_SECRET;
  const store = await cookies();
  // Older builds kept the raw password in this cookie; never leave it behind.
  store.delete({ name: LEGACY_PASSWORD_COOKIE, path: `/s/${token}` });
  if (secret && password) {
    store.set(GRANT_COOKIE, sealGrant(token, password, secret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: `/s/${token}`,
      maxAge: Math.floor(GRANT_TTL_MS / 1000),
    });
  } else {
    store.delete({ name: GRANT_COOKIE, path: `/s/${token}` });
  }
  logEvent("info", "share.unlock_submitted", { requestId: await currentRequestId() });
  redirect(`/s/${token}`);
}

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await load(token);
  const locale = localeFromAcceptLanguage((await headers()).get("accept-language"));

  // ui-neutral-chrome: the app's neutral colours around the page, as in the app.
  const shell = (children: React.ReactNode) => (
    <div className="ui-neutral-chrome min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 print:hidden">
        <a href={process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com"} className="inline-flex items-center gap-2 text-ink">
          <FoleviLogo height={22} />
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
      <form className="mx-auto mt-16 max-w-sm ui-card rounded-control p-6" action={unlock.bind(null, token)}>
        <h1 className="ui-display text-3xl">This page is protected</h1>
        <p className="mt-2 text-sm text-muted">Enter the password the owner gave you.</p>
        {result.status === "password_incorrect" ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            That password isn’t right.
          </p>
        ) : null}
        <label className="mt-4 block text-sm" htmlFor="pw">
          Password
        </label>
        <input id="pw" name="password" type="password" required autoComplete="off" className="mt-1 h-10 w-full ui-input rounded-chip px-3" />
        <button type="submit" className="mt-4 h-10 w-full ui-btn ui-btn-primary text-sm font-medium ">
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
        <h1 className="ui-display text-4xl">Page unavailable</h1>
        <p className="mt-3 text-muted">{copy}</p>
      </div>,
    );
  }
  const { document, blocks, fileUrls, collections } = result;
  // The link's look (lib/publishThemes.ts): the note's own style, or Article, Docs or Minimal.
  const publish = publishTheme(result.theme);
  const look = publishLook(publish, document.style);
  if (look.colors && document.cover.kind === "art") await loadThemes();
  const art = look.colors ? coverArtOf(document.cover) : null;
  const coverUrl = (document as { coverUrl?: string | null }).coverUrl ?? null;
  const bg = look.cover ? coverBackground(document.cover, document.style, coverUrl) : undefined;
  const updated = new Date(document.updatedAt);
  const backdrop = look.backdrop ? pageBackdrop(document.style, document.cover, coverUrl) : undefined;
  const coverPalette = (document as { coverPalette?: { paper: string; ink: string; paperDark: string; inkDark: string } | null }).coverPalette ?? null;
  const shareSheet = look.colors ? sheetProps(document.style, document.cover, coverPalette) : {};
  const toc = look.toc ? tableOfContents(blocks) : [];
  const page = (
    <article
      className="fb-page fb-sheet relative mx-auto max-w-[calc(var(--editor-width)+8rem)] min-w-0 rounded-control border border-line"
      data-font={look.font}
      data-width={look.width}
      data-background={look.colors ? document.style.background : "plain"}
      data-publish={publish}
      {...shareSheet}
      data-separator={document.style.separator}
      style={{ ...shareSheet.style, ...themeFontVars(art?.fonts), ["--doc-accent" as string]: document.style.accent === "accent" ? "var(--color-accent)" : `var(--color-${document.style.accent})` }}
    >
      {backdrop ? <SheetPageBreaks /> : null}
      {bg ? <div className="h-36 rounded-t-chip" style={{ background: bg }} aria-hidden /> : <div className="h-8" />}
      <div className="px-5 pb-6 pt-4 sm:px-16">
        <h1 className={`mt-2 text-[40px] leading-tight ${look.font === "serif" ? "ui-display [font-family:var(--note-serif,var(--font-serif))]" : look.font === "rounded" ? "font-semibold [font-family:var(--note-soft,var(--font-rounded))]" : look.font === "mono" ? "font-semibold [font-family:var(--note-mono,var(--font-mono))]" : "font-semibold tracking-tight [font-family:var(--note-modern,var(--font-modern))]"}`}>{document.title || "Untitled"}</h1>
        <p className="mb-6 mt-1 text-xs text-muted">{tFor(locale, "share.lastUpdated", { date: formatDate(updated, { dateStyle: "medium", timeZone: "UTC" }, locale) })}</p>
        {toc.length > 1 ? (
          // Docs on narrower screens: the same contents, folded away above the note (the side list needs room).
          <details className="fb-publish-toc-compact group mb-6 rounded-control border border-line xl:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium text-heading [&::-webkit-details-marker]:hidden">
              Contents
              <ChevronDown size={15} aria-hidden className="text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <nav aria-label="Contents" className="border-t border-line px-1 py-2">
              <TocList toc={toc} />
            </nav>
          </details>
        ) : null}
        <ReadOnlyBlocks blocks={blocks} fileUrls={fileUrls} collections={collections} anchors={toc.length > 0} />
      </div>
    </article>
  );
  return shell(
    // The page floats on its backdrop, as in the app.
    <div className={backdrop ? "fb-publish-backdrop relative rounded-chip px-3 py-8 sm:px-8" : ""} style={backdrop && !document.style.blur ? { background: backdrop } : undefined}>
    {backdrop && document.style.blur ? <BlurredBackdrop background={backdrop} /> : null}
    {toc.length > 1 ? (
      // Docs: the contents sit beside the page on wide screens, and stay in view while reading.
      <div className="mx-auto max-w-[calc(var(--layout-editor-width-wide)+8rem+15rem)] xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-8">
        <nav aria-label="Contents" className="fb-publish-toc hidden xl:block">
          <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto pt-10">
            <p className="ui-caps mb-2 px-2">Contents</p>
            <TocList toc={toc} />
          </div>
        </nav>
        {page}
      </div>
    ) : (
      page
    )}
    </div>,
  );
}

/** The Docs contents: each heading as a link to it, indented by level. */
function TocList({ toc }: { toc: ReturnType<typeof tableOfContents> }) {
  return (
    <ol className="space-y-0.5 text-[13px]">
      {toc.map((h) => (
        <li key={h.id} style={{ paddingLeft: `${(h.level - 1) * 0.75}rem` }}>
          <a href={`#block-${h.id}`} className="block truncate rounded-chip px-2 py-1 text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  );
}
