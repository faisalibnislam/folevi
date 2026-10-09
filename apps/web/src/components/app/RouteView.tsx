"use client";

import { lazy, Suspense, useEffect } from "react";
import { useAppRouter } from "@/lib/app/router";
import { DocumentBrowser } from "@/components/views/DocumentBrowser";
import { TasksView } from "@/components/views/TasksView";
import { CalendarView } from "@/components/views/CalendarView";
import { SharedView } from "@/components/views/SharedView";
import { HelpView } from "@/components/views/HelpView";
import { InviteView } from "@/components/views/InviteView";
import { ShareInviteView } from "@/components/views/ShareInviteView";
import { FoldersIndex, TagsIndex } from "@/components/views/OrganizeIndex";
import { HomeDashboard } from "@/components/views/HomeDashboard";
import { AiView } from "@/components/views/AiView";
import { ViewChrome } from "./Shell";
import { loadDocumentView, loadedDocumentView } from "@/lib/app/noteView";

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
const SettingsView = lazy(() => import("@/components/views/SettingsView").then((m) => ({ default: m.SettingsView })));
if (typeof window !== "undefined" && window.location.pathname.startsWith("/d/")) void loadDocumentView();

/** Where a note will be, while its code arrives: the same frame and placeholder lines DocumentView shows. */
function NoteLoading() {
  return (
    <ViewChrome title="">
      <div className="fb-page relative h-full overflow-y-auto rounded-[14px] bg-[var(--color-surface-sunken)] px-3 pb-28 pt-8 shadow-[var(--glass-edge),var(--glass-shadow)] sm:px-8">
        <div className="mx-auto max-w-3xl space-y-3 py-6" aria-busy aria-label="Loading document">
          {[80, 95, 60, 88].map((w, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-sunken motion-reduce:animate-none" style={{ width: `${w}%` }} />
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
  return <Routes />;
}

function Routes() {
  const { route } = useAppRouter();
  switch (route.name) {
    case "documents":
      return <HomeDashboard />;
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
      return (
        <Suspense fallback={<NoteLoading />}>
          <DocumentView key={route.id} documentId={route.id} />
        </Suspense>
      );
    case "ai":
      return <AiView id={route.id} />;
    case "tasks":
      return <TasksView view={route.view} />;
    case "calendar":
      return <CalendarView month={route.month} />;
    case "daily":
      // Daily Notes were retired; old links land on Home.
      return <RedirectHome />;
    case "shared":
      return <SharedView />;
    case "settings":
      return (
        <Suspense fallback={<ViewChrome title="Settings">{null}</ViewChrome>}>
          <SettingsView section={route.section} />
        </Suspense>
      );
    case "help":
      return <HelpView />;
    case "invite":
      return <InviteView token={route.token} />;
    case "share-invite":
      return <ShareInviteView token={route.token} />;
    default:
      return (
        <ViewChrome title="Not found">
          <div className="mx-auto max-w-lg px-6 py-24 text-center">
            <h1 className="ui-display text-4xl">This page doesn’t exist</h1>
            <p className="mt-3 text-muted">It may have been moved, or the link is incomplete.</p>
            <a href="/documents" className="mt-6 inline-block text-accent underline underline-offset-2">
              Go to Home
            </a>
          </div>
        </ViewChrome>
      );
  }
}

function RedirectHome() {
  const { navigate } = useAppRouter();
  useEffect(() => navigate("/documents", { replace: true }), [navigate]);
  return null;
}
