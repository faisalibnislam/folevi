"use client";

import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, type DocumentCover } from "@folevi/editor-schema";
import { NoteCardFace, noteLook, type PreviewLine } from "@/components/views/DocumentCard";

// No server here: every query stays loading and every call is refused (as the marketing hero's editor).
const noWatch = { onUpdate: () => () => undefined, localQueryResult: () => undefined, journal: () => undefined, localQueryLogs: () => undefined };
const refuse = () => Promise.reject(new Error("Offline"));
const OFFLINE = {
  watchQuery: () => noWatch,
  watchPaginatedQuery: () => noWatch,
  query: refuse,
  mutation: refuse,
  action: refuse,
  connectionState: () => ({ isWebSocketConnected: false, hasInflightRequests: false }),
} as unknown as ConvexReactClient;

const DAY = 86_400_000;
const p = (t: string, x: string, extra: Partial<PreviewLine> = {}): PreviewLine => ({ t, x, ...extra });
const art = (n: number): DocumentCover => ({ kind: "art", value: `art-${String(n).padStart(2, "0")}` });

const SAMPLES: { title: string; shape?: string; kind?: string; starred?: boolean; cover?: DocumentCover; preview: PreviewLine[]; folder?: string }[] = [
  { title: "Field Notes: A Quiet Morning", preview: [p("paragraph", "The kettle took longer than usual. Outside, the street was the colour of wet slate."), p("heading", "Noticed", { l: 2 }), p("bulleted", "Two magpies on the aerial")], folder: "Personal" },
  { title: "Packing list", starred: true, cover: art(3), shape: "list", preview: [p("paragraph", "Passport, charger, the good socks."), p("todo", "Buy travel adapters"), p("todo", "Check in online", { c: true })], folder: "Travel" },
  { title: "Project Atlas Brief", shape: "pages", preview: [p("paragraph", "Goal: a lightweight field guide app for the city's community gardens."), p("page", "Research"), p("page", "Plan")], folder: "Projects" },
  { title: "Welcome Home", shape: "tabs", cover: art(7), preview: [p("paragraph", "Everything for the first week in the new house.")], folder: "House" },
  { title: "Moodboard and files", shape: "pocket", preview: [p("image", ""), p("file", "floorplan.pdf"), p("bookmark", "Paint colours")], folder: "House" },
  { title: "Customer Target Flow", shape: "canvas", preview: [p("flowchart", ""), p("paragraph", "Cold email, replies, form, response.")], folder: "Brainstorming" },
  { title: "Inbox", shape: "list", cover: art(11), preview: [p("todo", "Call the dentist"), p("todo", "Plan the weekend walk"), p("todo", "Water the plants"), p("todo", "Pick up dry cleaning", { c: true })] },
  { title: "Weekly review", kind: "template", preview: [p("heading", "Wins", { l: 2 }), p("bulleted", ""), p("heading", "Next week", { l: 2 })] },
];

export function CardLooks() {
  return (
    <ConvexProvider client={OFFLINE}>
      <main className="ui-canvas min-h-dvh px-6 py-10">
        <h1 className="ui-display text-large-title">Card looks</h1>
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-6 gap-y-10">
          {SAMPLES.map((s) => (
            <div key={s.title} data-look={noteLook(s)}>
              <div className="aspect-[25/27]">
                <NoteCardFace
                  title={s.title}
                  excerpt=""
                  preview={s.preview}
                  cover={s.cover ?? DEFAULT_COVER}
                  style={DEFAULT_DOCUMENT_STYLE}
                  createdAt={Date.now() - 3 * DAY}
                  time="2 days ago"
                  starred={s.starred}
                  folder={s.folder ? { id: s.folder, name: s.folder, color: null } : null}
                  showFolder={s.kind !== "template"}
                  shape={s.shape}
                  kind={s.kind}
                />
              </div>
              <p className="mt-3 text-footnote text-muted">{noteLook(s)}</p>
            </div>
          ))}
        </div>
      </main>
    </ConvexProvider>
  );
}
