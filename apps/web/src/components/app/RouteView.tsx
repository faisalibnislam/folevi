"use client";

import { NotePanes } from "./NotePanes";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { useAppRouter } from "@/lib/app/router";
import { DocumentBrowser } from "@/components/views/DocumentBrowser";
import { TasksView } from "@/components/views/TasksView";
import { CalendarView } from "@/components/views/CalendarView";
import { FoldersIndex, TagsIndex } from "@/components/views/OrganizeIndex";
import { HomeDashboard } from "@/components/views/HomeDashboard";
import { ViewChrome } from "./Shell";
import { loadDocumentView, loadedDocumentView } from "@/lib/app/noteView";
import { useAppState } from "@/lib/app/state";
import { api } from "@/lib/convex/api";
import { inboxPage } from "@/lib/share/save";
import { useIpadLayout, useIphoneApp } from "@/lib/iphone";
import { IphoneHome } from "@/components/iphone/IphoneHome";
import { useCanCall, useCapabilities } from "@/lib/mode";
import { EmptyState } from "@/components/ui/EmptyState";
import { Waypoints } from "lucide-react";
import { SignInToCollaborate } from "./SignInToCollaborate";

/**
 * A page loaded when it's first opened, that can also be fetched ahead (`preload`): once its code is here, lazy() is
 * handed it on the spot and draws the page in the same turn instead of its empty frame first.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function soon<C extends React.ComponentType<any>>(load: () => Promise<C>): [React.LazyExoticComponent<C>, () => Promise<C>] {
  let ready: C | null = null;
  const fetch = () =>
    load().then((c) => {
      ready = c;
      return c;
    });
  const View = lazy(() => {
    const here = ready;
    if (here) return { then: (resolve: (m: { default: C }) => void) => resolve({ default: here }) } as unknown as Promise<{ default: C }>;
    return fetch().then((c) => ({ default: c }));
  });
  return [View, fetch];
}

// A note's page brings the editor, which is most of the app's code: it loads on its own, so the first
// screen paints without it. It starts downloading straight away when the app opens on a note (alongside
// signing in), otherwise as soon as the first screen is up, so a new note is ready to type in.
// When the code is already here (the usual case: it's fetched as soon as the app opens, and New note waits
// for it), the answer is handed over synchronously: React.lazy then renders the note at once instead of
// showing its placeholder for a frame, which left focus on the New note button for the first keys.
const DocumentView = lazy(() => {
  const ready = loadedDocumentView();
  if (ready) return { then: (resolve: (m: { default: typeof ready }) => void) => resolve({ default: ready }) } as unknown as Promise<{ default: typeof ready }>;
  return loadDocumentView().then((m) => ({ default: m.DocumentView }));
});
const [SettingsView, preloadSettings] = soon(() => import("@/components/views/SettingsView").then((m) => m.SettingsView));
// The Foli AI page (its chat) and the graph load when they're opened, never with the first screen
// (docs/MAC_WEBKIT_PLAN.md "Memory", step 4).
const [AiView, preloadAi] = soon(() => import("@/components/views/AiView").then((m) => m.AiView));
const GraphView = lazy(() => import("@/components/views/GraphView").then((m) => ({ default: m.GraphView })));
// Pages a few people open now and then load when they're opened too: Changes and Reviews (each brings the
// read-only drawing of every kind of block), Shared with Me, Help and the invitations. Kept out of the code
// every launch reads before the first screen (docs/IOS_PERFORMANCE.md, "Startup").
const [ReviewView, preloadReview] = soon(() => import("@/components/views/ReviewView").then((m) => m.ReviewView));
const [ChangesView, preloadChanges] = soon(() => import("@/components/views/ChangesView").then((m) => m.ChangesView));
const [SharedView, preloadShared] = soon(() => import("@/components/views/SharedView").then((m) => m.SharedView));
const HelpView = lazy(() => import("@/components/views/HelpView").then((m) => ({ default: m.HelpView })));
const InviteView = lazy(() => import("@/components/views/InviteView").then((m) => ({ default: m.InviteView })));
const ShareInviteView = lazy(() => import("@/components/views/ShareInviteView").then((m) => ({ default: m.ShareInviteView })));
const [VaultView, preloadVault] = soon(() => import("@/components/vault/VaultView").then((m) => m.VaultView));
const SharedFolderView = lazy(() => import("@/components/views/SharedFolderView").then((m) => ({ default: m.SharedFolderView })));
const FolderInviteView = lazy(() => import("@/components/views/FolderInviteView").then((m) => ({ default: m.FolderInviteView })));

/** A page whose code is still on its way: its frame and title, nothing in it yet. */
function Later({ title, children }: { title: string; children: React.ReactNode }) {
  return <Suspense fallback={<ViewChrome title={title}>{null}</ViewChrome>}>{children}</Suspense>;
}
if (typeof window !== "undefined" && window.location.pathname.startsWith("/d/")) void loadDocumentView();

/** Where a note will be, while its code arrives: the same frame and placeholder lines DocumentView shows. */
function NoteLoading() {
  const iphone = useIphoneApp();
  return (
    <ViewChrome title="" iphone={{ large: false, innerScroll: true }}>
      <div className={iphone ? "relative h-full px-3 pt-[calc(env(safe-area-inset-top)+72px)]" : "fb-page relative h-full overflow-y-auto rounded-panel bg-[var(--color-surface-sunken)] px-3 pb-28 pt-8 shadow-[var(--glass-edge),var(--glass-shadow)] sm:px-8"}>
        <div className="mx-auto max-w-3xl space-y-3 py-6" aria-busy aria-label="Loading document">
          {[80, 95, 60, 88].map((w, i) => (
            <div key={i} className="h-4 animate-pulse rounded-tiny bg-sunken motion-reduce:animate-none" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </ViewChrome>
  );
}

export function RouteView() {
  // Once the first screen is up, fetch the note page's code (waiting for the browser to be idle let a
  // quick New note open before it arrived, and the first keys typed went nowhere).
  useEffect(() => {
    void loadDocumentView();
  }, []);
  // On the phone and the iPad a page slides or swaps in: the pages kept out of the first screen's code are fetched once the app is
  // idle, one after another, so opening one slides in the page itself, not its empty frame with the rest popping
  // in mid-move. (Not on the Mac or the web, where they wait to be opened: docs/MAC_WEBKIT_PLAN.md "Memory".)
  const iphone = useIphoneApp();
  const ipad = useIpadLayout();
  useEffect(() => {
    if (!iphone && !ipad) return;
    let stopped = false;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = async () => {
      for (const load of [preloadSettings, preloadAi, preloadChanges, preloadShared, preloadReview, preloadVault]) {
        if (stopped) return;
        await load().catch(() => undefined);
      }
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void run(), { timeout: 6000 });
      return () => {
        stopped = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const t = setTimeout(() => void run(), 3000);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [iphone, ipad]);
  return <Routes />;
}

/** An account's page (Changes, Shared with Me, an invitation) opened in local mode: the one note instead. */
function AccountOnly({ title }: { title: string }) {
  return (
    <ViewChrome title={title}>
      <SignInToCollaborate variant="page" />
    </ViewChrome>
  );
}

function Routes() {
  const { route } = useAppRouter();
  const iphone = useIphoneApp();
  const caps = useCapabilities();
  // A library on this device has its own Vault (docs/MAC_REBUILD_PLAN.md §5.6) where local mode has it.
  const vaultHere = useCanCall(api.vault.get);
  if (!caps.changes && route.name === "changes") return <AccountOnly title="Changes" />;
  if (!caps.sharing && (route.name === "shared" || route.name === "shared-folder")) return <AccountOnly title="Shared with Me" />;
  if (!caps.sharing && route.name === "folder-invite") return <AccountOnly title="Invitation" />;
  if (!caps.sharing && !vaultHere && route.name === "vault") return <AccountOnly title="Vault" />;
  if (!caps.workspaces && route.name === "invite") return <AccountOnly title="Invitation" />;
  if (!caps.sharing && route.name === "share-invite") return <AccountOnly title="Invitation" />;
  switch (route.name) {
    case "documents":
      return iphone ? <IphoneHome /> : <HomeDashboard />;
    case "notes":
      return <DocumentBrowser view="all" title="All notes" />;
    case "starred":
    case "archive":
    case "trash":
    case "templates":
    case "unsorted":
      return <DocumentBrowser view={route.name} />;
    case "folder":
      return <DocumentBrowser key={route.id} view="folder" folderId={route.id} />;
    case "tag":
      return <DocumentBrowser key={route.id} view="tag" tagId={route.id} />;
    case "folders":
      return <FoldersIndex />;
    case "tags":
      return <TagsIndex />;
    case "doc":
      // A note, or notes joined side by side (each pane its own page; the one with focus is in the address).
      return iphone ? (
        <Suspense fallback={<NoteLoading />}>
          <DocumentView key={route.id} documentId={route.id} />
        </Suspense>
      ) : (
        <NotePanes
          documentId={route.id}
          render={(id) => (
            <Suspense fallback={<NoteLoading />}>
              <DocumentView key={id} documentId={id} />
            </Suspense>
          )}
        />
      );
    case "ai":
      return (
        <Suspense fallback={<ViewChrome title="Foli AI">{null}</ViewChrome>}>
          <AiView id={route.id} />
        </Suspense>
      );
    case "graph":
      return <Graph />;
    case "inbox":
      return <OpenInbox />;
    case "tasks":
      return <TasksView view={route.view} />;
    case "calendar":
      return <CalendarView month={route.month} />;
    case "review":
      return (
        <Later title="Review">
          <ReviewView />
        </Later>
      );
    case "changes":
      return (
        <Later title="Changes">
          <ChangesView />
        </Later>
      );
    case "daily":
      // Daily Notes were retired; old links land on Home.
      return <RedirectHome />;
    case "shared":
      return (
        <Later title="Shared with Me">
          <SharedView />
        </Later>
      );
    case "vault":
      return (
        <Later title="Vault">
          <VaultView />
        </Later>
      );
    case "shared-folder":
      return (
        <Later title="Shared folder">
          <SharedFolderView key={route.id} folderId={route.id} />
        </Later>
      );
    case "folder-invite":
      return (
        <Later title="Invitation">
          <FolderInviteView token={route.token} />
        </Later>
      );
    case "settings":
      return (
        <Suspense fallback={<ViewChrome title="Settings">{null}</ViewChrome>}>
          <SettingsView section={route.section} />
        </Suspense>
      );
    case "help":
      return (
        <Later title="Help">
          <HelpView />
        </Later>
      );
    case "invite":
      return (
        <Later title="Invitation">
          <InviteView token={route.token} />
        </Later>
      );
    case "share-invite":
      return (
        <Later title="Invitation">
          <ShareInviteView token={route.token} />
        </Later>
      );
    default:
      return (
        <ViewChrome title="Not found">
          <div className="mx-auto max-w-lg px-6 py-24 text-center">
            <h1 className="ui-display text-large-title">This page doesn’t exist</h1>
            <p className="mt-3 text-muted">It may have been moved, or the link is incomplete.</p>
            <a href="/documents" className="mt-6 inline-block text-accent underline underline-offset-2">
              Go to Home
            </a>
          </div>
        </ViewChrome>
      );
  }
}

/**
 * /inbox (folevi://inbox from the iOS app's widgets and Shortcuts, any link to the Inbox): the person's Inbox
 * page in the current place, the one shares and quick-added tasks go to, opened in its place. Online the
 * server finds it (and brings it back from Trash); offline it's the page's deterministic id, made here if
 * this device never had it. /tasks/inbox stays the Tasks view of undated tasks.
 */
function OpenInbox() {
  const { navigate } = useAppRouter();
  const { engine, profile, deviceId, online, scope } = useAppState();
  const prepareInbox = useMutation(api.tasks.inbox);
  const started = useRef(false);
  useEffect(() => {
    if (!engine || started.current) return;
    started.current = true;
    inboxPage({ engine, profileId: profile.id, deviceId, online, prepareInbox }, scope)
      .then((inbox) => navigate(`/d/${inbox.documentId}`, { replace: true }))
      .catch(() => navigate("/documents", { replace: true }));
  }, [engine, profile.id, deviceId, online, prepareInbox, scope, navigate]);
  return <NoteLoading />;
}

/** The graph, where this backend has it (local mode gets it later, lib/local/registry.ts LOCAL_PLANNED). */
function Graph() {
  if (useCanCall(api.aiGraph.graph)) {
    return (
      <Suspense fallback={<ViewChrome title="Foli DNA">{null}</ViewChrome>}>
        <GraphView />
      </Suspense>
    );
  }
  return (
    <ViewChrome title="Foli DNA">
      <EmptyState icon={Waypoints} title="Foli DNA isn’t available here yet" body="It isn’t part of a library on your devices yet. Links between notes still work everywhere." />
    </ViewChrome>
  );
}

function RedirectHome() {
  const { navigate } = useAppRouter();
  useEffect(() => navigate("/documents", { replace: true }), [navigate]);
  return null;
}
