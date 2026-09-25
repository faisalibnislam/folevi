"use client";

import { useEffect } from "react";
import { useAppRouter } from "@/lib/app/router";
import { DocumentBrowser } from "@/components/views/DocumentBrowser";
import { DocumentView } from "@/components/doc/DocumentView";
import { TasksView } from "@/components/views/TasksView";
import { CalendarView } from "@/components/views/CalendarView";
import { SharedView } from "@/components/views/SharedView";
import { SettingsView } from "@/components/views/SettingsView";
import { HelpView } from "@/components/views/HelpView";
import { InviteView } from "@/components/views/InviteView";
import { ViewChrome } from "./Shell";

export function RouteView() {
  const { route } = useAppRouter();
  switch (route.name) {
    case "documents":
      return <DocumentBrowser view="all" />;
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
    case "doc":
      return <DocumentView key={route.id} documentId={route.id} />;
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
      return <SettingsView section={route.section} />;
    case "help":
      return <HelpView />;
    case "invite":
      return <InviteView token={route.token} />;
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
