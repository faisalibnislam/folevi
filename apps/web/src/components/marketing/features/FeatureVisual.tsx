import type { ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  Cloud,
  CloudOff,
  Copy,
  Eraser,
  FileCode,
  FileText,
  FolderUp,
  GitMerge,
  Globe,
  Highlighter,
  History,
  LayoutTemplate,
  Loader2,
  Pencil,
  Printer,
  Share2,
  Star,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { MERMAID_SAMPLE } from "@/components/editor/insertCatalog";
import { FlowchartStatic } from "@/components/editor/flowchart/render";
import "@/components/editor/flowchart/flowchart.css";
import { AiIcon } from "@/components/ai/AiIcon";
import { mermaidToFlowchart, serializeFlowchart, WHITEBOARD_COLORS } from "@folevi/editor-schema";
import { GALLERY_TEMPLATES } from "../content/templates";
import type { FeatureVisual as VisualKey } from "../content/features";
import { ConnectDemo } from "../demos/ConnectDemo";
import { AskDemo } from "../demos/AskDemo";
import { AudioDemo } from "../demos/AudioDemo";
import { SlashDemo } from "../home/SlashDemo";
import { CalendarPicture, CommentsPicture, PalettePicture, VersionsPicture } from "./MorePictures";
import { EditDemo } from "../demos/EditDemo";
import { FlowchartDemo } from "../demos/FlowchartDemo";
import { ReturnDemo } from "../demos/ReturnDemo";
import { SECURITY_CONTROLS } from "../home/Closing";
import { Icon } from "../icons";
import { StatusPill, type SyncStatus } from "../mini";
import { artById, artThumb, artVars } from "../product/Replica";
import { FoldersPageReplica } from "../product/FoldersPageReplica";
import { StyleShowcase } from "../product/StyleShowcase";
import { TemplateSheet } from "../templates/TemplateSheet";
import { cx } from "../ui";

/*
 * One product picture per feature page, built from the site's replicas of the app (Replica.tsx, the demos,
 * the Ask Foli panel) and the app's own renderers where they run on the server (the flowchart). Labels match
 * the app's. Pictures that aren't interactive are one image for assistive tech, with the details in the label.
 */

export function FeatureVisual({ visual, art }: { visual: VisualKey; art: string }) {
  if (visual === "styles") return <StyleShowcase />;
  if (visual === "security") return <SecurityGrid />;
  if (visual === "folders") {
    // The Folders page replica, as in the home page's Folders section.
    return (
      <div className="mk-stage p-2 sm:p-6 lg:p-8" style={{ ["--stage-art" as string]: artThumb(artById(art)) }}>
        <FoldersPageReplica />
      </div>
    );
  }
  return (
    <div className="mk-stage px-3 py-8 sm:px-8 sm:py-12" style={{ ["--stage-art" as string]: artThumb(artById(art)) }}>
      <Visual visual={visual} art={art} />
    </div>
  );
}

/**
 * The picture for a feature's card on the features index (FeatureCover): just the app piece, on its stage,
 * at the width it is drawn at before being scaled into the card, so the UI fills the cover.
 */
export function coverPicture(visual: VisualKey, art: string): { width: number; node: ReactNode } {
  const pieces: Record<VisualKey, [number, ReactNode]> = {
    ai: [520, <AskDemo key="ai" />],
    audio: [600, <AudioDemo key="audio" />],
    slash: [520, <SlashDemo key="slash" />],
    search: [660, <PalettePicture key="search" />],
    calendar: [960, <CalendarPicture key="calendar" />],
    comments: [640, <CommentsPicture key="comments" />],
    versions: [820, <VersionsPicture key="versions" />],
    offline: [640, <SyncStatuses key="offline" />],
    tasks: [780, <ReturnDemo key="tasks" />],
    linked: [820, <ConnectDemo key="linked" />],
    folders: [1000, <FoldersPageReplica key="folders" />],
    flowchart: [820, <FlowchartDemo key="flowchart" />],
    whiteboard: [760, <WhiteboardPicture key="whiteboard" art={art} />],
    styles: [980, <StyleShowcase key="styles" artSize="thumb" />],
    sharing: [620, <SharePanel key="sharing" />],
    workspaces: [780, <WorkspacePanels key="workspaces" />],
    templates: [980, <TemplateTrio key="templates" />],
    export: [780, <ExportPanels key="export" />],
    security: [780, <SecurityGrid key="security" />],
  };
  const [width, piece] = pieces[visual];
  return {
    width,
    node: (
      <div className="mk-stage p-7" style={{ ["--stage-art" as string]: artThumb(artById(art)) }}>
        {piece}
      </div>
    ),
  };
}

function Visual({ visual, art }: { visual: VisualKey; art: string }) {
  switch (visual) {
    case "ai":
      return (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <AskDemo />
          <EditDemo />
        </div>
      );
    case "audio":
      return <AudioDemo />;
    case "slash":
      return <SlashDemo />;
    case "search":
      return <PalettePicture />;
    case "calendar":
      return <CalendarPicture />;
    case "comments":
      return <CommentsPicture />;
    case "versions":
      return <VersionsPicture />;
    case "offline":
      return <SyncStatuses />;
    case "tasks":
      return (
        <div className="mx-auto max-w-[860px]">
          <ReturnDemo />
        </div>
      );
    case "linked":
      return (
        <div className="mx-auto max-w-[860px]">
          <ConnectDemo />
        </div>
      );
    case "flowchart":
      return (
        <div className="space-y-8">
          <FlowchartDemo />
          <FlowchartPicture art={art} />
        </div>
      );
    case "whiteboard":
      return <WhiteboardPicture art={art} />;
    case "sharing":
      return <SharePanel />;
    case "workspaces":
      return <WorkspacePanels />;
    case "templates":
      return <TemplateTrio />;
    case "export":
      return <ExportPanels />;
    default:
      return null;
  }
}

/* Shared frame --------------------------------------------------------------------------------------- */

function Pop({ label, title, icon, children, className }: { label: string; title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cx("mk-app-pop mx-auto w-full overflow-hidden rounded-[14px] text-[13px]", className)}>
      <div aria-hidden="true">
        <div className="flex items-center gap-2.5 border-b border-(--color-line) px-4 py-3">
          {icon}
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-(--color-heading)">{title}</p>
          <X size={15} className="flex-none text-muted" />
        </div>
        {children}
      </div>
    </div>
  );
}

function MenuRow({ icon, label, hint, active = false }: { icon: ReactNode; label: string; hint?: string; active?: boolean }) {
  return (
    <li className={cx("flex h-8 items-center gap-2.5 rounded-[6px] px-2.5", active ? "mk-app-row-on" : "text-ink")}>
      <span className="flex-none text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="flex-none text-[11px] text-faint">{hint}</span> : null}
    </li>
  );
}

/* AI --------------------------------------------------------------------------------------------------- */


/* Offline and sync -------------------------------------------------------------------------------------- */

const STATUS_ROWS: Array<{ status: SyncStatus; icon: ReactNode; detail?: string; body: string }> = [
  { status: "Saved", icon: <Cloud size={15} />, body: "Every change has reached the server and been confirmed." },
  { status: "Saving", icon: <Loader2 size={15} />, body: "Online, and recent edits are on their way." },
  { status: "Offline", icon: <CloudOff size={15} />, detail: "3 waiting", body: "No connection. Edits are stored on this device." },
  { status: "Syncing", icon: <Loader2 size={15} />, body: "Back online. Sending yours, fetching the rest." },
  { status: "Conflict", icon: <GitMerge size={15} />, body: "The same block changed in two places. You choose." },
  { status: "Error", icon: <AlertTriangle size={15} />, body: "A change couldn’t be applied. Open it to retry." },
];

function SyncStatuses() {
  return (
    <div
      role="img"
      aria-label="The six sync statuses a Folevi page can show: Saved, Saving, Offline with 3 edits waiting on this device, Syncing, Conflict and Error, each with what it means."
      className="mk-card mx-auto max-w-[640px] overflow-hidden"
    >
      <div aria-hidden="true">
        <div className="flex h-11 items-center gap-2 border-b mk-hair px-4">
          <FileText size={14} className="flex-none text-muted" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-(--color-heading)">Train notes</p>
          <StatusPill status="Offline" detail="3 waiting" />
        </div>
        <ul className="divide-y divide-(--mk-hair)">
          {STATUS_ROWS.map((row) => (
            <li key={row.status} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="w-[150px] flex-none">
                <StatusPill status={row.status} detail={row.detail} />
              </span>
              <span className="text-[13.5px] leading-snug text-ink">{row.body}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t mk-hair bg-(--mk-well) px-4 py-3 text-[12.5px]">
          <span className="text-muted">Conflict:</span>
          {["Keep mine", "Keep theirs", "Keep both"].map((label) => (
            <span key={label} className="mk-btn mk-btn-secondary h-7 px-2.5 text-[12px]">
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Tasks ---------------------------------------------------------------------------------------------- */

/* Flowchart ------------------------------------------------------------------------------------------- */

function sampleFlowchart(): string {
  const result = mermaidToFlowchart(MERMAID_SAMPLE);
  return result.ok ? serializeFlowchart(result.data) : "";
}

function FlowchartPicture({ art }: { art: string }) {
  const data = sampleFlowchart();
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
      <figure className="mk-note overflow-hidden" style={artVars(artById(art))}>
        <div className="flex items-center gap-2 border-b border-[color-mix(in_oklab,var(--n-ink)_12%,transparent)] px-4 py-2.5 text-[12px] font-medium text-(--n-muted)">
          <span className="rounded-[5px] bg-[color-mix(in_oklab,var(--n-ink)_7%,transparent)] px-1.5 leading-5">Flowchart</span>
          <span className="flex-1" />
          <span aria-hidden="true">Tidy up</span>
          <span aria-hidden="true" className="inline-flex items-center gap-1">
            <AiIcon size={12} /> AI
          </span>
        </div>
        <div className="px-3 py-6 sm:px-6 [&_.fc-static]:flex [&_.fc-static]:justify-center">{data ? <FlowchartStatic data={data} height={380} /> : null}</div>
        <figcaption className="sr-only">A flowchart drawn by Folevi from the Mermaid sample in the next panel.</figcaption>
      </figure>
      <div className="mk-card overflow-hidden">
        <p className="flex h-10 items-center gap-2 border-b mk-hair px-4 text-[12.5px] font-semibold text-(--color-heading)">
          <FileCode size={14} aria-hidden="true" className="text-muted" /> Mermaid diagram
        </p>
        <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.7] text-ink">
          <code>{MERMAID_SAMPLE}</code>
        </pre>
        <p className="border-t mk-hair px-4 py-3 text-[12.5px] text-muted">
          <span className="font-medium text-(--color-heading)">Convert to flowchart</span> turns this into the chart beside it.
        </p>
      </div>
    </div>
  );
}

/* Whiteboard ------------------------------------------------------------------------------------------ */

const PEN = ["ink", "blue", "red", "green", "orange", "purple"] as const;

function WhiteboardPicture({ art }: { art: string }) {
  const ink = "var(--n-ink)";
  return (
    <div
      role="img"
      aria-label="A whiteboard block in a note: a toolbar with Pen, Highlighter and Eraser, six pen colours, three pen sizes, Undo and Clear, above a sketch of three jars on a shelf, drawn with the pen and the highlighter."
      className="mk-note mx-auto max-w-[760px] overflow-hidden"
      style={artVars(artById(art))}
    >
      <div aria-hidden="true">
        {/* One row at every width: on phones the controls are a little smaller and two pen colours are left out. */}
        <div className="flex items-center gap-0.5 overflow-hidden border-b border-[color-mix(in_oklab,var(--n-ink)_12%,transparent)] px-2 py-2 sm:gap-1 sm:px-3">
          {[
            { icon: <Pencil size={14} />, on: true },
            { icon: <Highlighter size={14} /> },
            { icon: <Eraser size={14} /> },
          ].map((tool, i) => (
            <span key={i} className={cx("grid size-7 flex-none place-items-center rounded-[6px] sm:size-8", tool.on ? "mk-app-dock-on" : "text-(--n-muted)")}>
              {tool.icon}
            </span>
          ))}
          <span className="mx-1 h-5 w-px bg-[color-mix(in_oklab,var(--n-ink)_18%,transparent)]" />
          {PEN.map((c, i) => (
            <span
              key={c}
              className={cx("mx-px size-4 flex-none rounded-full sm:mx-0 sm:size-5", i >= 4 && "hidden sm:block", i === 1 && "shadow-[0_0_0_2px_var(--n-paper),0_0_0_3.5px_var(--n-ink)]")}
              style={{ background: WHITEBOARD_COLORS[c] }}
            />
          ))}
          <span className="mx-1 hidden h-5 w-px bg-[color-mix(in_oklab,var(--n-ink)_18%,transparent)] sm:block" />
          {[2.5, 5, 10].map((w, i) => (
            <span key={w} className={cx("hidden size-8 place-items-center rounded-[6px] sm:grid", i === 0 && "bg-[color-mix(in_oklab,var(--n-ink)_8%,transparent)]")}>
              <span className="rounded-full bg-(--n-ink)" style={{ width: w + 2, height: w + 2 }} />
            </span>
          ))}
          <span className="flex-1" />
          <span className="grid size-7 flex-none place-items-center text-(--n-muted) sm:size-8">
            <Undo2 size={14} />
          </span>
          <span className="grid size-7 flex-none place-items-center text-(--n-muted) sm:size-8">
            <Trash2 size={14} />
          </span>
        </div>
        <svg viewBox="0 0 1000 380" className="block h-auto w-full" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M120 250 C 330 246, 600 254, 860 248" stroke={ink} strokeWidth="5" />
          {[200, 420, 640].map((x, i) => (
            <g key={x}>
              <path d={`M${x} 244 C ${x - 4} 200, ${x - 6} 160, ${x + 4} 128 L ${x + 116} 126 C ${x + 124} 160, ${x + 122} 200, ${x + 118} 244`} stroke={ink} strokeWidth="5" />
              <path d={`M${x + 16} 124 C ${x + 40} 108, ${x + 80} 108, ${x + 102} 122`} stroke={ink} strokeWidth="5" />
              <path d={`M${x + 24} 190 C ${x + 50} 184, ${x + 72} 196, ${x + 96} 188`} stroke={[WHITEBOARD_COLORS.blue, WHITEBOARD_COLORS.green, WHITEBOARD_COLORS.red][i]} strokeWidth="10" />
            </g>
          ))}
          <path d="M160 312 C 340 300, 520 322, 700 306" stroke={WHITEBOARD_COLORS.yellow} strokeWidth="26" opacity="0.4" />
          <path d="M800 90 C 780 120, 770 150, 776 180 M752 160 L 776 184 L 800 162" stroke={WHITEBOARD_COLORS.orange} strokeWidth="5" />
        </svg>
      </div>
    </div>
  );
}

/* Sharing --------------------------------------------------------------------------------------------- */

function SharePanel() {
  const people = [
    { name: "Ada Example", note: "You", role: "Owner" },
    { name: "Ines Moreau", note: "ines@example.com", role: "Can edit" },
    { name: "Sam Rivera", note: "Guest", role: "Can comment" },
  ];
  return (
    <Pop
      label="The Share dialog for a page. Ines can edit, Sam is a guest who can comment, and there's a row to invite someone by email with Can view, Can comment or Can edit. Below, a public link that expires on 12 October, is password protected and has been opened 4 times, with a Revoke button, and fields to set an expiry and a password for a new link."
      title="Share Seed library"
      icon={<Share2 size={15} className="text-muted" />}
      className="max-w-[560px]"
    >
      <div className="space-y-5 px-4 py-4">
        <div>
          <p className="text-[13px] font-semibold text-(--color-heading)">Who has access</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="mk-app-well flex h-9 min-w-0 flex-1 items-center rounded-[6px] px-3 text-faint">name@example.com</span>
            <span className="mk-btn mk-btn-secondary h-9 gap-1 px-3 text-[12.5px]">
              Can view <ChevronDown size={13} />
            </span>
            <span className="mk-btn mk-btn-primary h-9 px-3 text-[12.5px]">Invite</span>
          </div>
          <ul className="mt-3 space-y-1">
            {people.map((p) => (
              <li key={p.name} className="flex items-center gap-2.5 py-1">
                <span className="grid size-7 flex-none place-items-center rounded-full bg-(--color-heading) text-[11px] font-semibold text-(--color-canvas)">{p.name[0]}</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">{p.note}</span>
                </span>
                <span className="flex-none text-[12px] text-muted">{p.role}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-(--color-line) pt-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-(--color-heading)">
            <Globe size={14} /> Public link
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">Off by default. Anyone with the link can read this page (not its comments or nested pages). Links aren’t indexed by search engines and can be revoked instantly.</p>
          <div className="mt-3 flex items-center gap-3 rounded-[6px] border border-(--color-line) px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[11.5px] text-ink">…/s/k3Jd••••••••</span>
              <span className="block truncate text-[11.5px] text-muted">Expires 12 Oct · Password protected · 4 views</span>
            </span>
            <span className="flex-none text-[12px] font-medium text-coral-ink">Revoke</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <span className="text-[11.5px] text-muted">
              Expires (optional)
              <span className="mk-app-well mt-1 block h-8 rounded-[6px]" />
            </span>
            <span className="text-[11.5px] text-muted">
              Password (optional, 8+ characters)
              <span className="mk-app-well mt-1 block h-8 rounded-[6px]" />
            </span>
            <span className="mk-btn mk-btn-primary h-8 self-end px-3 text-[12px]">Create link</span>
          </div>
        </div>
      </div>
    </Pop>
  );
}

/* Team workspaces ---------------------------------------------------------------------------------------- */

function WorkspacePanels() {
  const spaces = [
    { name: "Personal", role: "", on: false },
    { name: "Alder Street Studio", role: "Owner", on: true },
    { name: "Reading group", role: "Member", on: false },
  ];
  const members = [
    { name: "Ada Example", role: "Owner", seat: true },
    { name: "Ines Moreau", role: "Admin", seat: true },
    { name: "Theo Park", role: "Member", seat: true },
    { name: "Priya Shah", role: "Member · can comment", seat: true },
    { name: "Sam Rivera", role: "Guest", seat: false },
  ];
  return (
    <div
      role="img"
      aria-label="Two panels. The switcher lists Personal first, then two workspaces with your role: Owner of Alder Street Studio and Member of Reading group. The members list for Alder Street Studio shows an owner, an admin, two members (one who can only comment) and a guest. Four seats are billed; the guest is free."
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
    >
      <div aria-hidden="true" className="mk-app-pop mx-auto w-full max-w-[340px] rounded-[14px] p-1.5 text-[13px]">
        <p className="mk-caps px-2.5 pb-1 pt-2 text-[10.5px]">Switch to</p>
        <ul className="space-y-0.5">
          {spaces.map((s) => (
            <li key={s.name} className={cx("flex h-10 items-center gap-2.5 rounded-[8px] px-2.5", s.on ? "mk-app-row-on" : "text-ink")}>
              <span className="grid size-6 flex-none place-items-center rounded-[6px] bg-(--color-heading) text-[11px] font-semibold text-(--color-canvas)">{s.name[0]}</span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="flex-none text-[11.5px] font-normal text-muted">{s.role}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 flex h-9 items-center gap-2 border-t border-(--color-line) px-2.5 text-muted">
          <span className="text-[15px] leading-none">+</span> Create workspace
        </p>
      </div>
      <div aria-hidden="true" className="mk-card overflow-hidden text-[13px]">
        <div className="flex items-center justify-between gap-3 border-b mk-hair px-4 py-3">
          <p className="font-semibold text-(--color-heading)">Members</p>
          <span className="rounded-[6px] bg-(--color-surface-sunken) px-2 text-[11.5px] font-medium leading-6 text-muted">4 seats · Pro</span>
        </div>
        <ul className="divide-y divide-(--mk-hair)">
          {members.map((m) => (
            <li key={m.name} className="flex items-center gap-3 px-4 py-2.5">
              <span className="grid size-7 flex-none place-items-center rounded-full bg-(--color-surface-sunken) text-[11px] font-semibold text-(--color-heading)">{m.name[0]}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
              <span className="flex-none text-[12px] text-muted">{m.role}</span>
              <span className={cx("hidden w-14 flex-none text-right text-[11.5px] sm:block", m.seat ? "text-muted" : "font-medium text-moss-ink")}>{m.seat ? "Seat" : "Free"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* Templates -------------------------------------------------------------------------------------------- */

function TemplateTrio() {
  const picks = ["meeting-notes", "weekly-reset", "travel-plan"].map((key) => GALLERY_TEMPLATES.find((t) => t.key === key)!).filter(Boolean);
  return (
    <div role="img" aria-label="Three built-in templates as new pages: Meeting Notes, Weekly Reset and Travel Plan." className="grid gap-4 md:grid-cols-3">
      {picks.map((t, i) => (
        <div key={t.key} aria-hidden="true" className={cx("h-[340px] overflow-hidden rounded-[10px] [mask-image:linear-gradient(black_80%,transparent)]", i === 2 && "hidden md:block")}>
          <TemplateSheet blocks={t.blocks} title={t.name} compact topHeading={3} className="h-full" />
        </div>
      ))}
    </div>
  );
}

/* Import and export -------------------------------------------------------------------------------------- */

function ExportPanels() {
  return (
    <div
      role="img"
      aria-label="A page's menu with Share, Version history, Export as Markdown, Export as HTML, Export as PDF (print), Duplicate, Save as template and Archive. Beside it, Settings, Import and export: import Markdown or text files or a folder, and export everything in Personal as a ZIP."
      className="grid items-start gap-6 lg:grid-cols-2"
    >
      <div aria-hidden="true" className="mk-app-pop mx-auto w-full max-w-[320px] rounded-[12px] p-1.5 text-[13px]">
        <ul className="space-y-0.5">
          <MenuRow icon={<Star size={14} />} label="Star" />
          <MenuRow icon={<Share2 size={14} />} label="Share…" />
          <MenuRow icon={<History size={14} />} label="Version history…" />
        </ul>
        <div className="my-1 border-t border-(--color-line)" />
        <ul className="space-y-0.5">
          <MenuRow icon={<FileText size={14} />} label="Export as Markdown" active />
          <MenuRow icon={<FileCode size={14} />} label="Export as HTML" />
          <MenuRow icon={<Printer size={14} />} label="Export as PDF (print)" />
        </ul>
        <div className="my-1 border-t border-(--color-line)" />
        <ul className="space-y-0.5">
          <MenuRow icon={<Copy size={14} />} label="Duplicate" />
          <MenuRow icon={<LayoutTemplate size={14} />} label="Save as template" />
          <MenuRow icon={<Archive size={14} />} label="Archive" />
        </ul>
      </div>
      <div aria-hidden="true" className="mk-card space-y-5 p-5 text-[13px]">
        <p className="mk-caps text-[10.5px]">Settings · Import &amp; export</p>
        <div>
          <p className="font-semibold text-(--color-heading)">Import into Personal</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Markdown or text files, a folder, or a ZIP. Images they link to come along.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="mk-btn mk-btn-secondary h-8 gap-1.5 px-3 text-[12.5px]">
              <Upload size={13} /> Choose files…
            </span>
            <span className="mk-btn mk-btn-secondary h-8 gap-1.5 px-3 text-[12.5px]">
              <FolderUp size={13} /> Import a folder…
            </span>
          </div>
        </div>
        <div className="border-t mk-hair pt-5">
          <p className="font-semibold text-(--color-heading)">Export Personal</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">A ZIP with every document as Markdown, all attachments in an assets folder, and a manifest.json.</p>
          <span className="mk-btn mk-btn-primary mt-3 h-8 px-3 text-[12.5px]">Export Personal (.zip)</span>
        </div>
      </div>
    </div>
  );
}

/* Security -------------------------------------------------------------------------------------------- */

function SecurityGrid() {
  return (
    <div className="mk-panel p-5 sm:p-8">
      <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {SECURITY_CONTROLS.map((control) => (
          <li key={control.title}>
            <span className="mk-tile">
              <Icon name={control.icon} size={17} />
            </span>
            <p className="mk-h3 mt-3.5 text-[15.5px]">{control.title}</p>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{control.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
