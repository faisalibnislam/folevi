"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Bookmark, ChevronDown, CircleHelp, Download, FileText, Focus, Maximize, Pause, Play, Search, SlidersHorizontal, Sparkles, Tag as TagIcon, Waypoints, X, ZoomIn, ZoomOut, FolderInput, ChartNetwork } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { openNextInNewTab } from "@/lib/app/tabs";
import { useFolderTree } from "@/lib/app/folders";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { ViewChrome, useShell } from "@/components/app/Shell";
import { Button, IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { MenuButton } from "@/components/ui/Menu";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { folderHex } from "@/lib/folderColors";
import { useNoteActions } from "@/components/views/noteActions";
import {
  boundsOf,
  degrees,
  drawnRadius,
  fitTransform,
  graphList,
  hitRadius,
  matchNodes,
  neighbours,
  nextInDirection,
  radiusFor,
  shapePath,
  Simulation,
  toScreen,
  topConnected,
  zoomAround,
  type Direction,
  type GraphEdgeData,
  type GraphNodeData,
  type Point,
  type ViewTransform,
} from "@/lib/graph/layout";
import {
  asOf,
  bridges as findBridges,
  clusterCircle,
  fitPoints,
  labelPlan,
  shortLabel,
  cleanSettings,
  clusters as findClusters,
  DEFAULT_SETTINGS,
  filterGraph,
  groupOf,
  hubs as findHubs,
  isWeakAiLine,
  labelBudget,
  localGraph,
  newSince,
  orphans as findOrphans,
  timeSpan,
  toMarkdown,
  toSvg,
  within,
  type DnaEdge,
  type DnaNode,
  type DnaSettings,
} from "@/lib/graph/analysis";
import { indexGraph, neighbourhood, type AroundEdge, type Names } from "@/lib/graph/neighbourhood";
import { DnaConnections, DnaLegend, DnaNodePanel, DnaTour, type LegendShows } from "@/components/views/DnaGuide";
import { EmptyState } from "@/components/ui/EmptyState";
import { canPurchaseHere } from "@/lib/nativeApp";

const ENTITY_KINDS = ["person", "project", "organization", "topic", "decision"] as const;
type EntityKind = (typeof ENTITY_KINDS)[number];

/** Notes stay neutral; each kind of entity takes one of the app's accent colours (and its own shape). */
export const KIND_COLOR: Record<string, string> = {
  note: "var(--color-ink-muted)",
  person: "var(--color-coral)",
  project: "var(--color-accent)",
  organization: "var(--color-moss)",
  topic: "var(--color-marigold)",
  decision: "var(--color-plum)",
};
export const KIND_LABEL: Record<string, string> = { note: "Note", person: "Person", project: "Project", organization: "Organization", topic: "Topic", decision: "Decision" };
const KIND_FILTER_LABEL: Record<EntityKind, string> = { person: "People", project: "Projects", organization: "Organizations", topic: "Topics", decision: "Decisions" };
const EDGE_LABEL: Record<string, string> = { link: "Linked", mention: "Mentions", similar: "Similar", related: "Related", references: "Refers to", contradicts: "Contradicts", supersedes: "Replaces" };
/** Clusters shade in these, in turn (faint washes, so notes keep their own colour). */
const CLUSTER_TINTS = ["var(--color-accent)", "var(--color-moss)", "var(--color-marigold)", "var(--color-plum)", "var(--color-coral)", "var(--color-ink-muted)"];
const tagColor = (color: string | null | undefined) => `var(--color-${!color || color === "muted" ? "ink-muted" : color})`;
const DAY = 86_400_000;
const EDITED: { value: string; label: string; days: number | null }[] = [
  { value: "any", label: "Edited any time", days: null },
  { value: "7", label: "Edited this week", days: 7 },
  { value: "30", label: "Edited this month", days: 30 },
  { value: "90", label: "Edited in 3 months", days: 90 },
  { value: "365", label: "Edited this year", days: 365 },
];
/** Past this many nodes the map draws less (labels for hubs only, edges as one path): it stays smooth. */
export const LARGE_GRAPH = 400;

type GraphData = {
  full: boolean;
  note: string | null;
  upgrade: boolean;
  truncated: boolean;
  nodes: DnaNode[];
  edges: DnaEdge[];
  folders?: { id: string; name: string; color: string | null }[];
  tags?: { id: string; name: string; color: string | null }[];
  suggested?: { source: string; target: string; entities: string[] }[];
  duplicates?: { a: string; b: string; score: number }[];
};

/**
 * Foli DNA (/graph): the current context's notes and the links between them, and where the plan includes it,
 * the people, projects, organizations, topics and decisions they mention. Around one note (`?note=<id>&depth=2`),
 * filtered by folder, tag and date, coloured by kind, folder or tag, with clusters, suggested links, a time-lapse
 * and saved views (`?view=<id>`). A force layout on SVG with pan, zoom, labels and keyboard moves; a note opens on
 * click or Enter (⌘-click: a new tab), an entity shows its notes. The List view shows the same map as text.
 */
export function GraphView() {
  const { scope } = useAppState();
  const { navigate, search } = useAppRouter();
  const scopeKey = scope.kind === "personal" ? "personal" : scope.workspaceId;
  const [stored, setStored] = useLocalStorage<unknown>(`folevi:dna-settings:${scopeKey}`, DEFAULT_SETTINGS);
  const settings = useMemo(() => cleanSettings(stored), [stored]);
  const set = useCallback((patch: Partial<DnaSettings>) => setStored((cur: unknown) => ({ ...cleanSettings(cur), ...patch })), [setStored]);
  const setFilter = (patch: Partial<DnaSettings["filter"]>) => set({ filter: { ...settings.filter, ...patch } });
  const kinds = (settings.kinds?.length ? settings.kinds : [...ENTITY_KINDS]) as EntityKind[];
  const [view, setView] = useLocalStorage<"graph" | "list">("folevi:graph-view", "graph");
  const [query, setQuery] = useState("");
  const [insights, setInsights] = useLocalStorage("folevi:dna-insights", false);
  const [focusMode, setFocusMode] = useLocalStorage("folevi:dna-focus", false);
  const [sinceWeek, setSinceWeek] = useState(false);
  // How many of the Show menu's choices differ from a fresh map (shown on its button).
  const changedShows = [settings.filter.linksOnly, !settings.filter.linksOnly && kinds.length !== ENTITY_KINDS.length, !settings.filter.hideOrphans, !settings.filter.hideAiLines, !settings.clusters, settings.arrows, focusMode, sinceWeek].filter(Boolean).length;
  const [playAt, setPlayAt] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  // Around one note (`?note=`), else the saved center. The note is sent along so it (and what it links to) is in
  // the map even when it wasn't edited lately: it was left out, and the map around it showed nothing.
  const center = search.get("note") ?? settings.center ?? null;
  const live = useQuery(api.aiGraph.graph, { scope, kinds: kinds.length === ENTITY_KINDS.length ? undefined : kinds, ...(center ? { center } : {}) });
  const savedViews = useQuery(api.graphViews.list, { scope });
  const saveView = useMutation(api.graphViews.save);
  const removeView = useMutation(api.graphViews.remove);
  const toast = useToast();
  // Keep showing the last graph of this context while a filter change loads.
  const last = useRef<{ key: string; data: GraphData } | null>(null);
  if (live) last.current = { key: scopeKey, data: live as GraphData };
  const data = (live as GraphData | undefined) ?? (last.current?.key === scopeKey ? last.current.data : undefined);
  const open = useCallback(
    (id: string, newTab = false) => {
      if (newTab) openNextInNewTab();
      navigate(`/d/${id}`);
    },
    [navigate],
  );

  // A saved view opened from the sidebar (`?view=`): its settings become the page's.
  const viewId = search.get("view");
  const appliedView = useRef<string | null>(null);
  useEffect(() => {
    if (!viewId || appliedView.current === viewId || !savedViews) return;
    const v = savedViews.find((x) => x.id === viewId);
    if (!v) return;
    appliedView.current = viewId;
    try {
      setStored(cleanSettings(JSON.parse(v.settings)));
    } catch {
      /* a view that doesn't read back stays as it was */
    }
  }, [viewId, savedViews, setStored]);

  // `?depth=2` or more (older links, saved views): the neighbours' own connections show too.
  const depthParam = Number(search.get("depth"));
  const depth = depthParam >= 1 && depthParam <= 3 ? depthParam : (settings.depth ?? 1);

  const all = useMemo(() => ({ nodes: data?.nodes ?? [], edges: data?.edges ?? [] }), [data]);
  const filtered = useMemo(() => filterGraph(all.nodes, all.edges, settings.filter), [all, settings.filter]);
  // The map around one note: it in the middle, what it's connected to one hop out (and the neighbours expanded),
  // each line saying why. It reads the whole map, not the filters (a filter hid the note itself, and the map was
  // empty); only "Foli AI's finds" switched off still leaves those out.
  const ai = !settings.filter.linksOnly;
  const index = useMemo(() => indexGraph(all.nodes, ai ? all.edges : all.edges.filter((e) => e.kind === "link"), ai ? (data?.suggested ?? []) : []), [all, ai, data]);
  const names = useMemo<Names>(() => {
    const tagName = new Map((data?.tags ?? []).map((t) => [t.id, t.name]));
    const folderName = new Map((data?.folders ?? []).map((f) => [f.id, f.name]));
    return { tag: (id) => tagName.get(id), folder: (id) => folderName.get(id) };
  }, [data]);
  const [expanded, setExpanded] = useState<{ center: string | null; ids: Set<string> }>({ center: null, ids: new Set() });
  const expandedIds = useMemo(() => {
    if (expanded.center === center) return expanded.ids;
    // A new note in the middle: nothing expanded, unless the link asked for more steps.
    if (!center || depth < 2) return new Set<string>();
    return new Set(neighbourhood(index, center, { ai })?.connections.filter((c) => index.byId.get(c.id)?.kind === "note").slice(0, 12).map((c) => c.id) ?? []);
  }, [expanded, center, depth, index, ai]);
  const toggleExpanded = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded({ center, ids: next });
  };
  const around = useMemo(() => (center ? neighbourhood(index, center, { expanded: expandedIds, ai, names }) : null), [center, index, expandedIds, ai, names]);
  const shown = useMemo(() => (center ? (around ? { nodes: around.nodes, edges: around.edges as DnaEdge[] } : { nodes: [], edges: [] }) : filtered), [center, around, filtered]);
  const centerNode = center ? all.nodes.find((n) => n.id === center) : undefined;
  // The node whose panel is open (why it's connected, in words).
  const [panel, setPanel] = useState<string | null>(null);
  const [panelFor, setPanelFor] = useState(center);
  if (panelFor !== center) {
    setPanelFor(center);
    setPanel(null);
  }
  const panelId = panel && index.byId.has(panel) ? panel : null;
  const whole = () => (set({ center: null }), navigate("/graph"));
  const mapAround = (id: string) => navigate(`/graph?note=${id}`);
  // The Key and the first-time tips (remembered on this device).
  const [legendOpen, setLegendOpen] = useLocalStorage("folevi:dna-key", true);
  const [tourDone, setTourDone] = useLocalStorage("folevi:dna-tour-done", false);
  const [tourStep, setTourStep] = useState(0);
  const notes = shown.nodes.filter((n) => n.kind === "note").length;
  const matches = useMemo(() => matchNodes(shown.nodes, query), [shown.nodes, query]);
  const orphanList = useMemo(() => findOrphans(filterGraph(all.nodes, all.edges, { ...settings.filter, hideOrphans: false }).nodes, filterGraph(all.nodes, all.edges, { ...settings.filter, hideOrphans: false }).edges), [all, settings.filter]);
  const clusterInfo = useMemo(() => findClusters(shown.nodes, shown.edges), [shown]);
  const bridgeSet = useMemo(() => findBridges(shown.edges, clusterInfo.of), [shown.edges, clusterInfo]);
  const hubList = useMemo(() => findHubs(shown.nodes, shown.edges, 10), [shown]);
  const suggested = useMemo(() => {
    const ids = new Set(shown.nodes.map((n) => n.id));
    return settings.filter.linksOnly ? [] : (data?.suggested ?? []).filter((s) => ids.has(s.source) && ids.has(s.target));
  }, [data, shown.nodes, settings.filter.linksOnly]);
  const duplicates = useMemo(() => data?.duplicates ?? [], [data]);
  const span = useMemo(() => timeSpan(shown.nodes), [shown.nodes]);
  // The time-lapse and "since last week" only change what's lit, never where things are.
  const visible = useMemo(() => (playAt === null ? null : new Set(asOf(shown.nodes, shown.edges, playAt).nodes.map((n) => n.id))), [playAt, shown]);
  // A stable "a week ago" for the page's life (the highlight doesn't drift while it's open).
  const [weekAgo] = useState(() => Date.now() - 7 * DAY);
  const fresh = useMemo(() => (sinceWeek ? newSince(shown.nodes, shown.edges, weekAgo) : null), [sinceWeek, shown, weekAgo]);

  // The time-lapse: about eight seconds from the first note to the last.
  useEffect(() => {
    if (playAt === null || !span) return;
    if (playAt >= span.end) {
      const t = setTimeout(() => setPlayAt(null), 1200);
      return () => clearTimeout(t);
    }
    const raf = requestAnimationFrame(() => setPlayAt((at) => (at === null ? null : Math.min(span.end, at + Math.max(1, (span.end - span.start) / 480)))));
    return () => cancelAnimationFrame(raf);
  }, [playAt, span]);

  const groups = useMemo(() => {
    if (settings.colorBy === "folder") return (data?.folders ?? []).map((f) => ({ id: f.id, name: f.name, color: folderHex(f.color) }));
    if (settings.colorBy === "tag") return (data?.tags ?? []).map((t) => ({ id: t.id, name: `#${t.name}`, color: tagColor(t.color) }));
    return [];
  }, [settings.colorBy, data]);
  const colorFor = useCallback(
    (n: DnaNode) => {
      const g = groupOf(n, settings.colorBy);
      if (g === null) return KIND_COLOR[n.kind] ?? KIND_COLOR.note!;
      return groups.find((x) => x.id === g)?.color ?? "var(--color-line-strong)";
    },
    [settings.colorBy, groups],
  );

  // What the Key lists: only what this map draws.
  const legendShows = useMemo<LegendShows>(() => {
    const kindsHere = new Set(shown.nodes.map((n) => n.kind));
    const edgeKinds = new Set(shown.edges.map((e) => e.kind));
    return {
      kinds: ["note", ...ENTITY_KINDS].filter((k) => kindsHere.has(k)).map((k) => ({ kind: k, label: KIND_LABEL[k] ?? k, color: KIND_COLOR[k] ?? KIND_COLOR.note! })),
      groups,
      colorBy: settings.colorBy,
      arrows: settings.arrows,
      mentions: edgeKinds.has("mention"),
      aiLines: shown.edges.some((e) => isWeakAiLine(e)),
      contradicts: edgeKinds.has("contradicts"),
      duplicates: edgeKinds.has("supersedes") || duplicates.length > 0,
      suggested: suggested.length > 0 || edgeKinds.has("suggested"),
      shared: edgeKinds.has("tag") || edgeKinds.has("folder"),
      clusters: Boolean(settings.clusters && !center && clusterInfo.clusters.length),
      bridges: Boolean(settings.clusters && !center && bridgeSet.size),
      fresh: Boolean(fresh?.nodes.size),
      pins: false,
    };
  }, [shown, center, groups, settings.colorBy, settings.arrows, settings.clusters, duplicates, suggested, clusterInfo, bridgeSet, fresh]);

  const settingsJson = JSON.stringify({ ...settings, center: center ?? null, depth });
  const onSave = async (name: string) => {
    try {
      await saveView({ scope, name, settings: settingsJson });
      toast.show(`Saved “${name}”`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  const exportRef = useRef<{ svg: () => string; markdown: () => string } | null>(null);
  const download = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const exportSvg = () => exportRef.current && download(new Blob([exportRef.current.svg()], { type: "image/svg+xml" }), "Foli DNA.svg");
  const exportPng = () => {
    if (!exportRef.current) return;
    const svg = exportRef.current.svg();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const scale = 2;
      c.width = img.width * scale;
      c.height = img.height * scale;
      const g = c.getContext("2d");
      if (!g) return;
      g.scale(scale, scale);
      g.drawImage(img, 0, 0);
      c.toBlob((b) => b && download(b, "Foli DNA.png"), "image/png");
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(shown.nodes, shown.edges, centerNode ? `Foli DNA of ${centerNode.label}` : "Foli DNA"));
      toast.show("Copied as Markdown");
    } catch {
      toast.show("Couldn’t copy. Try again.", { tone: "error" });
    }
  };
  const layoutBtn = useRef<HTMLButtonElement>(null);

  return (
    <ViewChrome title="Foli DNA" tabTitle="Foli DNA">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-2 px-4 pb-2 pt-1 sm:px-6">
          <div role="group" aria-label="View" className="ui-seg ui-well">
            <button type="button" aria-pressed={view === "graph"} onClick={() => setView("graph")} className="!min-h-8 px-3 text-subheadline">
              Map
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className="!min-h-8 px-3 text-subheadline">
              List
            </button>
          </div>
          <label className="ui-input flex h-8 min-w-[10rem] flex-1 items-center gap-1.5 rounded-chip px-2.5 sm:max-w-xs">
            <Search size={14} aria-hidden className="flex-none text-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches.size) window.dispatchEvent(new CustomEvent("folevi:dna-zoom-to", { detail: [...matches][0] }));
              }}
              placeholder="Find in Foli DNA"
              aria-label="Find in Foli DNA"
              className="min-w-0 flex-1 bg-transparent text-subheadline outline-none"
            />
          </label>
          <p className="ml-auto text-footnote tabular-nums text-faint" aria-live="polite">
            {data ? `${notes} ${notes === 1 ? "note" : "notes"}${shown.nodes.length > notes ? `, ${shown.nodes.length - notes} more` : ""}${query.trim() ? ` · ${matches.size} found` : ""}` : null}
          </p>
          {data ? (
              <div className="flex items-center gap-0.5">
                <IconButton
                  label={playAt === null ? "Play how it grew" : "Stop"}
                  disabled={!span || span.end === span.start}
                  onClick={() => setPlayAt((at) => (at === null && span ? span.start : null))}
                >
                  {playAt === null ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
                </IconButton>
                <IconButton ref={layoutBtn} label="Layout" aria-expanded={layoutOpen} onClick={() => setLayoutOpen((o) => !o)}>
                  <SlidersHorizontal size={15} aria-hidden />
                </IconButton>
                <IconButton label="Show the tips again" onClick={() => (setTourStep(0), setTourDone(false))}>
                  <CircleHelp size={15} aria-hidden />
                </IconButton>
                <IconButton label="Insights" aria-pressed={insights} onClick={() => setInsights(!insights)}>
                  <ChartNetwork size={15} aria-hidden />
                </IconButton>
                <MenuButton
                  label="Export"
                  trigger={<Download size={15} aria-hidden />}
                  items={[
                    { label: "Save as PNG", onSelect: exportPng },
                    { label: "Save as SVG", onSelect: exportSvg },
                    { label: "Copy as Markdown", onSelect: () => void copyMarkdown() },
                  ]}
                />
                <MenuButton
                  label="Saved views"
                  trigger={<Bookmark size={15} aria-hidden />}
                  items={[
                    { label: "Save this view…", onSelect: () => setSaveOpen(true) },
                    ...(savedViews ?? []).map((v) => ({
                      label: v.name,
                      onSelect: () => {
                        appliedView.current = null;
                        navigate(`/graph?view=${v.id}`);
                      },
                    })),
                    ...(savedViews?.length
                      ? [
                          {
                            label: "Remove a view…",
                            onSelect: () => {
                              const v = savedViews.find((x) => x.id === viewId) ?? savedViews[0]!;
                              void removeView({ id: v.id }).then(() => toast.show(`Removed “${v.name}”`));
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
          ) : null}
        </div>
        {data ? (
          <div role="toolbar" aria-label="Foli DNA filters" className="flex flex-none flex-wrap items-center gap-2 px-4 pb-2 sm:px-6">
            {!center ? (
            <>
            <Select aria-label="Folder" value={settings.filter.folders?.[0] ?? ""} onChange={(e) => setFilter({ folders: e.target.value ? [e.target.value] : [] })} className="h-8 text-subheadline">
              <option value="">All folders</option>
              {(data.folders ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Tag" value={settings.filter.tags?.[0] ?? ""} onChange={(e) => setFilter({ tags: e.target.value ? [e.target.value] : [] })} className="h-8 text-subheadline">
              <option value="">Any tag</option>
              {(data.tags ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Edited"
              value={EDITED.find((x) => x.days !== null && settings.filter.editedSince != null && Math.abs(Date.now() - x.days * DAY - settings.filter.editedSince) < DAY)?.value ?? "any"}
              onChange={(e) => {
                const days = EDITED.find((x) => x.value === e.target.value)?.days ?? null;
                setFilter({ editedSince: days === null ? null : Date.now() - days * DAY });
              }}
              className="h-8 text-subheadline"
            >
              {EDITED.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </Select>
            </>
            ) : null}
            <Select aria-label="Colour by" value={settings.colorBy} onChange={(e) => set({ colorBy: e.target.value as DnaSettings["colorBy"] })} className="h-8 text-subheadline">
              <option value="kind">Colour by kind</option>
              <option value="folder">Colour by folder</option>
              <option value="tag">Colour by tag</option>
            </Select>
            <MenuButton
              label={changedShows ? `Show, ${changedShows} changed` : "Show"}
              align="start"
              triggerClassName="h-8 px-1 text-subheadline"
              trigger={
                <span className="flex items-center gap-1">
                  {changedShows ? `Show · ${changedShows} changed` : "Show"}
                  <ChevronDown size={14} aria-hidden className="text-faint" />
                </span>
              }
              items={[
                ...(data.full
                  ? [
                      { heading: "Foli AI’s finds" },
                      { label: "Show Foli AI’s finds", checked: !settings.filter.linksOnly, multi: true, onSelect: () => setFilter({ linksOnly: !settings.filter.linksOnly }) },
                      { label: "Similar and related lines", description: "Foli AI’s weaker lines between notes", checked: !settings.filter.hideAiLines, multi: true, disabled: Boolean(settings.filter.linksOnly), onSelect: () => setFilter({ hideAiLines: !settings.filter.hideAiLines }) },
                      ...ENTITY_KINDS.map((k) => {
                        const on = kinds.includes(k);
                        return { label: KIND_FILTER_LABEL[k], checked: on, multi: true, disabled: Boolean(settings.filter.linksOnly), onSelect: () => set({ kinds: on ? kinds.filter((x) => x !== k) : ENTITY_KINDS.filter((x) => x === k || kinds.includes(x)) }) };
                      }),
                      "separator" as const,
                    ]
                  : []),
                { heading: "On the map" },
                { label: `Unlinked notes${orphanList.length ? ` (${orphanList.length})` : ""}`, checked: !settings.filter.hideOrphans, multi: true, onSelect: () => setFilter({ hideOrphans: !settings.filter.hideOrphans }) },
                { label: "Clusters", checked: settings.clusters, multi: true, onSelect: () => set({ clusters: !settings.clusters }) },
                { label: "Arrows", checked: settings.arrows, multi: true, onSelect: () => set({ arrows: !settings.arrows }) },
                { label: "Focus", description: "Dim notes more than two steps away", checked: focusMode, multi: true, onSelect: () => setFocusMode(!focusMode) },
                { label: "New this week", checked: sinceWeek, multi: true, onSelect: () => setSinceWeek(!sinceWeek) },
              ]}
            />
          </div>
        ) : null}
        {layoutOpen ? (
          <div role="group" aria-label="Layout" className="ui-pop mx-4 mb-2 flex flex-none flex-wrap items-center gap-4 rounded-panel px-3 py-2 text-subheadline sm:mx-6">
            <label className="flex items-center gap-2">
              Spacing
              <input type="range" min={0.5} max={2} step={0.1} value={settings.spacing} onChange={(e) => set({ spacing: Number(e.target.value) })} aria-label="Spacing" />
            </label>
            <label className="flex items-center gap-2">
              Pull to the middle
              <input type="range" min={0.25} max={3} step={0.25} value={settings.pull} onChange={(e) => set({ pull: Number(e.target.value) })} aria-label="Pull to the middle" />
            </label>
            <Button variant="quiet" onClick={() => (set({ spacing: 1, pull: 1 }), window.dispatchEvent(new Event(`folevi:dna-unpin`)))}>
              Reset layout
            </Button>
          </div>
        ) : null}
        {center && data ? (
          <div className="flex flex-none flex-wrap items-center gap-2 px-4 pb-2 text-subheadline sm:px-6">
            <Button variant="secondary" size="sm" onClick={whole}>
              <ArrowLeft size={14} aria-hidden className="-ml-1 mr-1" />
              Whole map
            </Button>
            <span className="text-muted">Around</span>
            {centerNode ? (
              <AppLink href={`/d/${centerNode.id}`} className="font-medium text-heading underline-offset-2 hover:underline">
                {centerNode.label || "Untitled"}
              </AppLink>
            ) : (
              <span className="text-heading">a note that isn’t here</span>
            )}
            {around ? <span className="text-footnote text-faint">{around.connections.length === 1 ? "1 connection" : `${around.connections.length} connections`}, one step out. Click a note to see why.</span> : null}
          </div>
        ) : null}
        {data?.note || data?.truncated ? (
          <p className="flex-none px-4 pb-2 text-subheadline text-muted sm:px-6">
            {data.note}
            {data.upgrade && canPurchaseHere() ? (
              <>
                {" "}
                <AppLink href="/settings/billing" className="text-heading underline underline-offset-2">
                  See plans
                </AppLink>
              </>
            ) : null}
            {data.truncated ? <span className="block">Showing the most recently edited notes.</span> : null}
          </p>
        ) : null}
        {!data ? (
          <p className="m-auto text-subheadline text-muted">Loading Foli DNA…</p>
        ) : center && !around ? (
          <EmptyState
            icon={Waypoints}
            title="This note isn’t on this map"
            body="It may be in another place (pick it in the sidebar’s account menu), in the Trash, or a template."
            action={<Button onClick={whole}>Show the whole map</Button>}
            className="m-auto"
          />
        ) : !all.nodes.length ? (
          <EmptyState icon={Waypoints} title="No notes here yet" body="Notes and the links between them show up here." className="m-auto" />
        ) : !shown.nodes.length ? (
          <EmptyState size="inline" title="Nothing matches these filters" className="m-auto" />
        ) : view === "list" ? (
          <GraphList nodes={shown.nodes} edges={shown.edges} query={query} />
        ) : (
          <div className="flex min-h-0 flex-1">
            <GraphCanvas
              nodes={shown.nodes}
              edges={shown.edges}
              matches={matches}
              searching={Boolean(query.trim())}
              onOpen={open}
              colorFor={colorFor}
              arrows={settings.arrows}
              clusters={settings.clusters && !center ? clusterInfo : undefined}
              bridges={settings.clusters && !center ? bridgeSet : undefined}
              suggested={center ? [] : suggested}
              duplicates={duplicates}
              visible={visible}
              fresh={fresh?.nodes ?? null}
              focusMode={focusMode}
              spacing={settings.spacing}
              pull={settings.pull}
              pinKey={`folevi:dna-pins:${scopeKey}`}
              center={center}
              exportRef={exportRef}
              playLabel={playAt !== null ? new Date(playAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : null}
              selected={panelId}
              onSelect={setPanel}
              sparse={
                around
                  ? around.connections.length
                    ? null
                    : "This note isn’t connected to anything yet. Type [[ in it to link another note, and a line joins them here."
                  : undefined
              }
              hidden={!center && settings.filter.hideOrphans && orphanList.length ? { count: orphanList.length, show: () => setFilter({ hideOrphans: false }) } : null}
              overlay={{
                topCenter: !tourDone ? <DnaTour step={tourStep} onStep={setTourStep} onDone={() => setTourDone(true)} /> : null,
                bottomLeft: <DnaLegend shows={legendShows} open={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} />,
                bottomRight: panelId ? (
                  <DnaNodePanel
                    key={panelId}
                    id={panelId}
                    index={index}
                    names={names}
                    ai={ai}
                    isCenter={panelId === center}
                    expand={around && around.nodes.some((n) => n.id === panelId) && panelId !== center && index.byId.get(panelId)?.kind === "note" ? { on: expandedIds.has(panelId), toggle: () => toggleExpanded(panelId) } : null}
                    onOpen={open}
                    onCenter={mapAround}
                    onPick={setPanel}
                    onClose={() => setPanel(null)}
                  />
                ) : null,
              }}
            />
            {around && center ? (
              <DnaConnections center={center} connections={around.connections} index={index} names={names} expanded={expandedIds} onToggle={toggleExpanded} onPick={setPanel} onWhole={whole} />
            ) : null}
            {insights && !center ? (
              <DnaInsights
                hubs={hubList}
                clusters={clusterInfo.clusters}
                bridges={[...bridgeSet].map((id) => shown.nodes.find((n) => n.id === id)).filter((n): n is DnaNode => Boolean(n))}
                orphans={orphanList}
                suggested={suggested}
                duplicates={duplicates}
                byId={new Map(all.nodes.map((n) => [n.id, n]))}
                scope={scope}
                full={Boolean(data.full)}
                onCenter={mapAround}
                onClose={() => setInsights(false)}
              />
            ) : null}
          </div>
        )}
      </div>
      <PromptDialog open={saveOpen} title="Save this view" label="Name" initial={centerNode ? `Around ${centerNode.label}` : ""} onClose={() => setSaveOpen(false)} onSubmit={(name) => (setSaveOpen(false), onSave(name))} />
    </ViewChrome>
  );
}

/**
 * Foli DNA's side list: the best-connected notes, clusters, notes that bridge them, unlinked notes, suggested links
 * (with Link), likely duplicates and contradictions (opening the note on its Related notes).
 */
function DnaInsights({
  hubs,
  clusters,
  bridges,
  orphans,
  suggested,
  duplicates,
  byId,
  scope,
  full,
  onCenter,
  onClose,
}: {
  hubs: (DnaNode & { degree: number })[];
  clusters: { id: number; name: string; members: string[] }[];
  bridges: DnaNode[];
  orphans: DnaNode[];
  suggested: { source: string; target: string; entities: string[] }[];
  duplicates: { a: string; b: string; score: number }[];
  byId: Map<string, DnaNode>;
  scope: ReturnType<typeof useAppState>["scope"];
  full: boolean;
  onCenter: (id: string) => void;
  onClose: () => void;
}) {
  const link = useMutation(api.aiGraph.linkNote);
  const contradictions = useQuery(api.aiGraph.contradictions, full ? { scope } : "skip");
  const { openAsk } = useShell();
  const toast = useToast();
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const name = (id: string) => byId.get(id)?.label || "Untitled";
  const noteLink = (id: string, panel = false) => (
    <AppLink href={`/d/${id}${panel ? "?panel=related" : ""}`} className="truncate text-ink underline-offset-2 hover:underline">
      {name(id)}
    </AppLink>
  );
  const section = (title: string, children: React.ReactNode, empty?: string) => (
    <section className="mt-4 first:mt-0">
      <h3 className="ui-caps mb-1.5">{title}</h3>
      {children ?? <p className="text-footnote text-faint">{empty}</p>}
    </section>
  );
  return (
    <aside aria-label="Insights" className="w-72 flex-none overflow-y-auto border-l border-line px-4 pb-[max(2rem,var(--fab-clearance))] pt-1 text-subheadline">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-body font-semibold text-heading">Insights</h2>
        <IconButton label="Close Insights" onClick={onClose} className="!h-7 !w-7">
          <X size={14} aria-hidden />
        </IconButton>
      </div>
      {section(
        "Hubs",
        hubs.length ? (
          <ol className="space-y-0.5">
            {hubs.map((h) => (
              <li key={h.id} className="flex items-center gap-1.5">
                <KindGlyph kind={h.kind} />
                <button type="button" onClick={() => onCenter(h.id)} className="min-w-0 flex-1 truncate text-left hover:underline">
                  {h.label || "Untitled"}
                </button>
                <span className="text-footnote tabular-nums text-faint">{h.degree}</span>
              </li>
            ))}
          </ol>
        ) : null,
        "Nothing is connected yet.",
      )}
      {section(
        "Clusters",
        clusters.length ? (
          <ul className="space-y-1">
            {clusters.slice(0, 12).map((c) => (
              <li key={c.id} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-2.5 flex-none rounded-chip" style={{ background: CLUSTER_TINTS[c.id % CLUSTER_TINTS.length] }} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-footnote tabular-nums text-faint">{c.members.length}</span>
                <IconButton
                  label={`Ask Foli AI to sum up ${c.name}`}
                  className="!h-6 !w-6"
                  onClick={() => openAsk(`Sum up what these notes say together: ${c.members.filter((m) => byId.get(m)?.kind === "note").slice(0, 20).map(name).join(", ")}.`)}
                >
                  <Sparkles size={12} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null,
        "Clusters show once a few notes link together.",
      )}
      {bridges.length ? section("Bridges", <ul className="space-y-0.5">{bridges.slice(0, 10).map((b) => <li key={b.id} className="flex">{b.kind === "note" ? noteLink(b.id) : <span>{b.label}</span>}</li>)}</ul>) : null}
      {full
        ? section(
            "Suggested links",
            suggested.length ? (
              <ul className="space-y-2">
                {suggested.slice(0, 12).map((s) => {
                  const key = `${s.source}:${s.target}`;
                  return (
                    <li key={key}>
                      <p className="flex flex-wrap gap-x-1">
                        {noteLink(s.source)} <span className="text-faint">and</span> {noteLink(s.target)}
                      </p>
                      <p className="text-footnote text-faint">Both mention {s.entities.join(", ")}</p>
                      <Button
                        variant="quiet"
                        className="mt-0.5 !h-7 !px-2"
                        disabled={linked.has(key)}
                        onClick={async () => {
                          try {
                            await link({ documentId: s.source, targetId: s.target });
                            setLinked((cur) => new Set(cur).add(key));
                            toast.show(`Linked ${name(s.source)} to ${name(s.target)}`);
                          } catch (e) {
                            toast.show(errorMessage(e), { tone: "error" });
                          }
                        }}
                      >
                        {linked.has(key) ? "Linked" : "Link them"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null,
            "No suggestions right now.",
          )
        : null}
      {section(
        "Unlinked notes",
        orphans.length ? (
          <ul className="space-y-0.5">
            {orphans.slice(0, 15).map((o) => (
              <li key={o.id} className="flex">
                {noteLink(o.id, full)}
              </li>
            ))}
            {orphans.length > 15 ? <li className="text-footnote text-faint">and {orphans.length - 15} more</li> : null}
          </ul>
        ) : null,
        "Every note links to another.",
      )}
      {orphans.length ? <p className="mt-1 text-footnote text-faint">{full ? "Open one to see the notes it could link to." : "Type [[ in a note to link it to another."}</p> : null}
      {full && duplicates.length
        ? section(
            "Likely duplicates",
            <ul className="space-y-1.5">
              {duplicates.slice(0, 10).map((d) => (
                <li key={`${d.a}:${d.b}`} className="flex flex-wrap gap-x-1">
                  {noteLink(d.a, true)} <span className="text-faint">and</span> {noteLink(d.b, true)}
                </li>
              ))}
            </ul>,
          )
        : null}
      {full && contradictions?.items.length
        ? section(
            "Contradictions",
            <ul className="space-y-1.5">
              {contradictions.items.slice(0, 10).map((c) => (
                <li key={`${c.from.id}:${c.from.blockId}:${c.to.id}`}>
                  <p className="flex flex-wrap gap-x-1">
                    {noteLink(c.from.id, true)} <span className="text-faint">{c.kind === "supersedes" ? "replaces" : "and"}</span> {noteLink(c.to.id, true)}
                  </p>
                  <p className="line-clamp-2 text-footnote text-faint">“{c.from.quote}”</p>
                </li>
              ))}
            </ul>,
          )
        : null}
    </aside>
  );
}

/** The map as text: every note and entity with what it's connected to. */
export function GraphList({ nodes, edges, query }: { nodes: GraphNodeData[]; edges: GraphEdgeData[]; query: string }) {
  const entries = useMemo(() => graphList(nodes, edges, query), [nodes, edges, query]);
  const noteEntries = entries.filter((e) => e.kind === "note");
  const entityEntries = entries.filter((e) => e.kind !== "note");
  if (!entries.length) return <EmptyState size="inline" title="Nothing matches" className="m-auto" />;
  const connections = (e: (typeof entries)[number]) =>
    e.connections.length ? (
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-subheadline text-muted" aria-label={`Connected to ${e.label || "Untitled"}`}>
        {e.connections.slice(0, 24).map((c) => (
          <li key={c.id}>
            <span className="text-faint">{EDGE_LABEL[c.edge] ?? "Related"}: </span>
            {c.kind === "note" ? (
              <AppLink href={`/d/${c.id}`} className="text-ink underline-offset-2 hover:underline">
                {c.label || "Untitled"}
              </AppLink>
            ) : (
              <span>
                {c.label} <span className="text-faint">({KIND_LABEL[c.kind]?.toLowerCase()})</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-1 text-subheadline text-faint">Not connected yet</p>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2.5rem,var(--fab-clearance))] sm:px-6">
      <section aria-labelledby="graph-list-notes">
        <h2 id="graph-list-notes" className="ui-caps mb-2 mt-2">
          Notes
        </h2>
        <ul className="space-y-3">
          {noteEntries.map((e) => (
            <li key={e.id}>
              <AppLink href={`/d/${e.id}`} className="inline-flex items-center gap-1.5 text-body font-medium text-heading underline-offset-2 hover:underline">
                <FileText size={14} aria-hidden className="text-muted" />
                {e.label || "Untitled"}
              </AppLink>
              {connections(e)}
            </li>
          ))}
        </ul>
      </section>
      {entityEntries.length ? (
        <section aria-labelledby="graph-list-entities" className="mt-6">
          <h2 id="graph-list-entities" className="ui-caps mb-2">
            People, projects and topics
          </h2>
          <ul className="space-y-3">
            {entityEntries.map((e) => (
              <li key={e.id}>
                <span className="inline-flex items-center gap-1.5 text-body font-medium text-heading">
                  <KindGlyph kind={e.kind} />
                  {e.label}
                  <span className="text-footnote font-normal text-faint">{KIND_LABEL[e.kind]}</span>
                </span>
                {connections(e)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Labels always shown for the best-connected nodes (the rest on hover, focus, search, or when zoomed in). */
export const ALWAYS_LABELLED = 12;

/** How wide a node's label is on screen, in pixels (11.5px in the page's font), measured once per text. */
const widths = new Map<string, number>();
let measurer: CanvasRenderingContext2D | null | undefined;
function labelWidth(text: string): number {
  const known = widths.get(text);
  if (known !== undefined) return known;
  if (measurer === undefined) {
    // (No canvas in tests' jsdom: the estimate stands in.)
    measurer = typeof document === "undefined" || /jsdom/i.test(navigator.userAgent) ? null : document.createElement("canvas").getContext("2d");
    if (measurer) measurer.font = `11.5px ${getComputedStyle(document.body).fontFamily}`;
  }
  const w = measurer ? measurer.measureText(text).width : text.length * 6.2;
  widths.set(text, w);
  return w;
}
/** Layout work per frame: the rest waits for the next one, so the page never stalls while it settles. */
const FRAME_BUDGET_MS = 8;

/** A small shape of a kind (the filters, the list, the legend): circle, diamond, square… */
export function KindGlyph({ kind, size = 10, muted = false }: { kind: string; size?: number; muted?: boolean }) {
  const r = size / 2 - 1;
  const d = shapePath(kind, r * 0.85);
  const fill = muted ? "var(--color-line-strong)" : KIND_COLOR[kind];
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden className="flex-none">
      {d ? <path d={d} fill={fill} /> : <circle r={r} fill={fill} />}
    </svg>
  );
}

/** What a node is called for screen readers: its name, kind and connections. */
export function nodeLabel(n: GraphNodeData, degree: number): string {
  const what = n.kind === "note" ? "note" : (KIND_LABEL[n.kind] ?? "Topic").toLowerCase();
  return `${n.label || "Untitled"}, ${what}, ${degree} ${degree === 1 ? "connection" : "connections"}`;
}

const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/** Pinned nodes, kept per place on this device. */
function readPins(key: string | undefined): Map<string, Point> {
  if (!key || typeof localStorage === "undefined") return new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, Point>;
    return new Map(Object.entries(raw).filter(([, p]) => Number.isFinite(p?.x) && Number.isFinite(p?.y)));
  } catch {
    return new Map();
  }
}
function writePins(key: string | undefined, pins: ReadonlyMap<string, Point>) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(pins)));
  } catch {
    /* full storage: pins last for the session */
  }
}

/**
 * The map itself: nodes sized by their connections (with a minimum that's easy to hit), the best-connected ones
 * labelled, entities shaped by kind, quiet edges, clusters shaded behind. The layout settles out of sight in small
 * slices of each frame, then shows once, fitted. Keyboard: Tab reaches the map's one stop, arrow keys move between
 * nodes, Enter opens a note or shows an entity's notes, Shift with the arrows pans, plus and minus zoom, 0 fits.
 * Pointer: drag a node to pin it there (double-click unpins), Shift-click or Shift-drag selects, ⌘-click opens in a
 * new tab, a suggested link's dashed line offers to link the two notes.
 */
export function GraphCanvas({
  nodes,
  edges,
  matches,
  searching,
  onOpen,
  colorFor,
  arrows = false,
  clusters,
  bridges,
  suggested = [],
  duplicates = [],
  visible = null,
  fresh = null,
  focusMode = false,
  spacing = 1,
  pull = 1,
  pinKey,
  center = null,
  exportRef,
  playLabel = null,
  compact = false,
  selected: selectedProp,
  onSelect,
  sparse: sparseProp,
  hidden = null,
  overlay,
}: {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  matches: Set<string>;
  searching: boolean;
  onOpen: (id: string, newTab?: boolean) => void;
  colorFor?: (n: DnaNode) => string;
  arrows?: boolean;
  clusters?: { clusters: { id: number; name: string; members: string[] }[]; of: Map<string, number> };
  bridges?: Set<string>;
  suggested?: { source: string; target: string; entities: string[] }[];
  duplicates?: { a: string; b: string; score: number }[];
  /** Only these show (the time-lapse); null: all. */
  visible?: Set<string> | null;
  /** These glow (new this week). */
  fresh?: Set<string> | null;
  focusMode?: boolean;
  spacing?: number;
  pull?: number;
  pinKey?: string;
  center?: string | null;
  exportRef?: React.MutableRefObject<{ svg: () => string; markdown: () => string } | null>;
  playLabel?: string | null;
  /** The Inspector's small map: no zoom buttons, tips or selection. */
  compact?: boolean;
  /**
   * The node whose panel is open, when the page shows one (why it's connected): a click picks a node, a
   * double-click (or Enter) opens a note. Without it a click opens a note and an entity lists its notes here.
   */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** What to say when the map has hardly anything in it (null: nothing; left out: the usual words). */
  sparse?: string | null;
  /** Unlinked notes left off the map, and how to bring them back. */
  hidden?: { count: number; show: () => void } | null;
  /** Cards over the map: the tips at the top, the Key bottom left, a panel bottom right. */
  overlay?: { topCenter?: React.ReactNode; bottomLeft?: React.ReactNode; bottomRight?: React.ReactNode };
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  const [positions, setPositions] = useState<ReadonlyMap<string, Point>>(() => new Map());
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [ring, setRing] = useState(false);
  const [stop, setStop] = useState<string | null>(null);
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const selected = onSelect ? (selectedProp ?? null) : ownSelected;
  const setSelected = useCallback(
    (v: string | null | ((cur: string | null) => string | null)) => {
      if (!onSelect) return setOwnSelected(v);
      onSelect(typeof v === "function" ? v(selectedProp ?? null) : v);
    },
    [onSelect, selectedProp],
  );
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [offer, setOffer] = useState<{ source: string; target: string; entities: string[]; x: number; y: number } | null>(null);
  const [pins, setPins] = useState<Map<string, Point>>(() => readPins(pinKey));
  const [dragging, setDragging] = useState<{ id: string; p: Point } | null>(null);
  const placed = useRef<ReadonlyMap<string, Point>>(new Map());
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const moved = useRef(false);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const tRef = useRef(t);
  tRef.current = t;

  // The container's size (the view fills it).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry!.contentRect.width, h: entry!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const deg = useMemo(() => degrees(edges), [edges]);
  const large = nodes.length > LARGE_GRAPH;
  const labelled = useMemo(() => topConnected(deg, large ? 8 : ALWAYS_LABELLED), [deg, large]);
  const shape = useMemo(() => `${nodes.map((n) => n.id).join(",")}|${edges.map((e) => `${e.source}>${e.target}`).join(",")}`, [nodes, edges]);
  const pinShape = useMemo(() => [...pins.entries()].map(([id, p]) => `${id}@${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(";"), [pins]);

  /** Shows all of the map (with room for the biggest nodes). */
  const clustersRef = useRef(clusters);
  clustersRef.current = clusters;
  const fitTo = useCallback((points: ReadonlyMap<string, Point>) => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    // The clusters' washes and names too: they ran under the filter bar.
    const groups = (clustersRef.current?.clusters ?? []).slice(0, 12).map((c) => c.members.map((m) => points.get(m)).filter((p): p is Point => Boolean(p)));
    const b = boundsOf(fitPoints(points.values(), groups));
    setT(fitTransform(b && { minX: b.minX - 20, minY: b.minY - 20, maxX: b.maxX + 20, maxY: b.maxY + 20 }, w, h, 36));
  }, []);

  // Lay out (again) when the map changes: a few milliseconds of steps per frame until it settles (or reaches its
  // step limit), then the result shows at once. Nodes seen before keep their place; pinned ones stay put.
  useEffect(() => {
    const sim = new Simulation(
      nodes.map((n) => n.id),
      edges,
      { previous: placed.current, pinned: pins, linkDistance: 70 * spacing, repulsion: 900 * spacing * spacing, pull },
    );
    let raf = 0;
    const step = () => {
      const start = performance.now();
      while (!sim.settled && performance.now() - start < FRAME_BUDGET_MS) sim.tick();
      if (!sim.settled) {
        raf = requestAnimationFrame(step);
        return;
      }
      const next = sim.positions();
      placed.current = next;
      setPositions(next);
      if (!moved.current) fitTo(next);
    };
    step();
    return () => cancelAnimationFrame(raf);
    // `shape` stands for nodes and edges, `pinShape` for the pins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, pinShape, spacing, pull, fitTo]);

  // Reset layout (the Layout panel): every pin goes.
  useEffect(() => {
    const unpin = () => {
      setPins(new Map());
      writePins(pinKey, new Map());
    };
    window.addEventListener("folevi:dna-unpin", unpin);
    return () => window.removeEventListener("folevi:dna-unpin", unpin);
  }, [pinKey]);

  // Size known or changed, or clusters shown or hidden: fit, unless the person has moved the view.
  const hasClusters = Boolean(clusters);
  useEffect(() => {
    if (!moved.current) fitTo(placed.current);
  }, [size.w, size.h, fitTo, hasClusters]);

  /** Moves the view to `id` smoothly (instantly with reduced motion), zoomed in enough to read. */
  const glideTo = useCallback((id: string) => {
    const p = placed.current.get(id);
    const { w, h } = sizeRef.current;
    if (!p || !w || !h) return;
    moved.current = true;
    const from = tRef.current;
    const k = Math.max(from.k, 1.4);
    const to = { k, x: w / 2 - p.x * k, y: h / 2 - p.y * k };
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setT(to);
    const start = performance.now();
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / 320);
      const e = 1 - Math.pow(1 - u, 3);
      setT({ k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);
  useEffect(() => {
    const onZoomTo = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      glideTo(id);
      setSelected(byId.get(id)?.kind === "note" ? null : id);
      nodeEls.current.get(id)?.focus({ preventScroll: true });
    };
    window.addEventListener("folevi:dna-zoom-to", onZoomTo);
    return () => window.removeEventListener("folevi:dna-zoom-to", onZoomTo);
  }, [glideTo, byId, setSelected]);

  // The export menu reads the map as drawn now.
  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = {
      svg: () => {
        const css = getComputedStyle(document.documentElement);
        const color = (v: string) => css.getPropertyValue(v.replace(/^var\((.+)\)$/, "$1")).trim() || "#888888";
        const colors = Object.fromEntries(Object.entries(KIND_COLOR).map(([k, v]) => [k, color(v)]));
        return toSvg(nodes, edges, placed.current, colors, { radius: (id) => radiusFor(deg.get(id) ?? 0, byId.get(id)?.kind !== "note"), labelled });
      },
      markdown: () => toMarkdown(nodes, edges),
    };
  }, [exportRef, nodes, edges, deg, byId, labelled]);

  // Wheel zoom around the pointer (a non-passive listener, so the page doesn't scroll too).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      moved.current = true;
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setT((cur) => zoomAround(cur, factor, e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toWorld = (sx: number, sy: number): Point => ({ x: (sx - t.x) / t.k, y: (sy - t.y) / t.k });

  // Pan with one pointer, pinch with two; a press on a node that moves drags (and pins) it; Shift and a drag on
  // empty space draws a selection box; a press that barely moves is a click.
  const pointers = useRef(new Map<number, Point>());
  const press = useRef<{ x: number; y: number; node: string | null; far: boolean; shift: boolean; meta: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const node = (e.target as Element).closest?.("[data-node]")?.getAttribute("data-node") ?? null;
    press.current = pointers.current.size === 1 ? { x: e.clientX, y: e.clientY, node, far: false, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey } : null;
    setOffer(null);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    const p = press.current;
    if (p && Math.hypot(now.x - p.x, now.y - p.y) > 5) p.far = true;
    const r = wrap.current!.getBoundingClientRect();
    if (pointers.current.size === 1) {
      if (p?.far && p.node && !compact) {
        // Drag the node (pinned where it's let go).
        setDragging({ id: p.node, p: toWorld(now.x - r.left, now.y - r.top) });
      } else if (p?.far && p.shift && !compact) {
        setBox({ x0: p.x - r.left, y0: p.y - r.top, x1: now.x - r.left, y1: now.y - r.top });
      } else if (p?.far) {
        moved.current = true;
        setT((cur) => ({ ...cur, x: cur.x + now.x - prev.x, y: cur.y + now.y - prev.y }));
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()].map(([id, q]) => (id === e.pointerId ? now : q));
      const [pa, pb] = [...pointers.current.values()];
      const before = Math.hypot(pa!.x - pb!.x, pa!.y - pb!.y) || 1;
      const after = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      moved.current = true;
      setT((cur) => zoomAround(cur, after / before, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top));
    }
    pointers.current.set(e.pointerId, now);
  };
  /**
   * A note opens; an entity shows (or hides) the notes that mention it. Where the page shows a panel, a click
   * (`pick`) opens it for that node instead, and Enter or a double-click opens the note.
   */
  const activate = (id: string, newTab = false, pick = false) => {
    const n = byId.get(id);
    if (onSelect && n && (pick || n.kind !== "note") && !newTab) {
      setSelected(id);
      return;
    }
    if (n?.kind === "note") {
      if (newTab) onOpen(n.id, true);
      else onOpen(n.id);
    } else if (n) setSelected((cur) => (cur === n.id ? null : n.id));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const p = press.current;
    press.current = null;
    if (dragging) {
      const next = new Map(pins).set(dragging.id, dragging.p);
      setPins(next);
      writePins(pinKey, next);
      setDragging(null);
      return;
    }
    if (box) {
      const [x0, x1] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
      const [y0, y1] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
      const inside = nodes.filter((n) => {
        const q = placed.current.get(n.id);
        if (!q || n.kind !== "note") return false;
        const s = toScreen(t, q);
        return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
      });
      setPicked((cur) => new Set([...cur, ...inside.map((n) => n.id)]));
      setBox(null);
      return;
    }
    if (!p || p.far) return;
    if (!p.node) {
      setSelected(null);
      if (!p.shift) setPicked(new Set());
      return;
    }
    if (p.shift && !compact && byId.get(p.node)?.kind === "note") {
      const id = p.node;
      setPicked((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    activate(p.node, p.meta, true);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest?.("[data-node]")?.getAttribute("data-node");
    if (!id) return;
    // A double-click opens a note (where a click shows its panel); on a pinned note it unpins it.
    if (!pins.has(id)) {
      if (onSelect && byId.get(id)?.kind === "note") onOpen(id, e.metaKey || e.ctrlKey);
      return;
    }
    const next = new Map(pins);
    next.delete(id);
    setPins(next);
    writePins(pinKey, next);
  };

  const zoomBy = (factor: number) => {
    moved.current = true;
    setT((cur) => zoomAround(cur, factor, size.w / 2, size.h / 2));
  };
  const refit = () => {
    moved.current = false;
    fitTo(placed.current);
  };
  /** Moves keyboard focus to a node, panning just enough to bring it into view. */
  const focusNode = (id: string) => {
    const p = placed.current.get(id);
    if (p && size.w && size.h) {
      const s = toScreen(t, p);
      const margin = 48;
      if (s.x < margin || s.x > size.w - margin || s.y < margin || s.y > size.h - margin) {
        moved.current = true;
        setT((cur) => ({ ...cur, x: size.w / 2 - p.x * cur.k, y: size.h / 2 - p.y * cur.k }));
      }
    }
    nodeEls.current.get(id)?.focus();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const on = (e.target as Element).closest?.("[data-node]")?.getAttribute("data-node") ?? null;
    const dir = ARROWS[e.key];
    if (dir && on && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const next = nextInDirection(placed.current, on, dir);
      if (next) focusNode(next);
      return;
    }
    if (dir) {
      // Shift and an arrow (or an arrow anywhere else in the map): pan.
      e.preventDefault();
      moved.current = true;
      const step = 40;
      const [dx, dy] = dir === "left" ? [step, 0] : dir === "right" ? [-step, 0] : dir === "up" ? [0, step] : [0, -step];
      setT((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    } else if ((e.key === "Enter" || e.key === " ") && on) {
      e.preventDefault();
      // Space shows why it's connected (where the page has that panel); Enter opens.
      activate(on, e.metaKey || e.ctrlKey, e.key === " ");
    } else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else if (e.key === "0") refit();
    else if (e.key === "Escape" && (selected || picked.size)) {
      e.stopPropagation();
      setSelected(null);
      setPicked(new Set());
    }
  };

  // Where each node is drawn: as laid out, or where it's being dragged.
  const at = useCallback((id: string) => (dragging?.id === id ? dragging.p : positions.get(id)), [dragging, positions]);
  // What's highlighted: the hovered, focused or selected node and its neighbours (focus mode: two steps), or the
  // search's matches.
  const focus = hover ?? focused ?? selected ?? (center && byId.has(center) ? center : null);
  const near = useMemo(() => (focus ? (focusMode ? within(edges, focus, 2) : new Set([focus, ...neighbours(edges, focus)])) : null), [focus, edges, focusMode]);
  const dimTo = focusMode ? 0.06 : 0.16;
  // The map's one Tab stop: the last node focused, else the best-connected one.
  const tabStop = stop && byId.has(stop) ? stop : ([...labelled][0] ?? nodes[0]?.id ?? null);
  const k = t.k;
  const dupKeys = useMemo(() => new Set(duplicates.map((d) => [d.a, d.b].sort().join(":"))), [duplicates]);
  const shows = (id: string) => !visible || visible.has(id);

  // Edges don't depend on pan or zoom (their stroke doesn't scale). Quiet ones go in one path per style (fast for
  // big maps); highlighted ones, arrows and special kinds are drawn on their own.
  const edgeLayer = useMemo(() => {
    const quiet: string[] = [];
    const out: React.ReactNode[] = [];
    edges.forEach((e, i) => {
      const a = at(e.source);
      const b = at(e.target);
      if (!a || !b || !shows(e.source) || !shows(e.target)) return;
      const on = near ? near.has(e.source) && near.has(e.target) : !searching || (matches.has(e.source) && matches.has(e.target));
      const dup = dupKeys.has([e.source, e.target].sort().join(":"));
      const shared = e.kind === "tag" || e.kind === "folder";
      const special = e.kind === "contradicts" || e.kind === "supersedes" || dup || shared || (e.inferred && e.kind !== "mention") || (arrows && e.kind === "link");
      if (!special && on && !near) {
        quiet.push(`M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
        return;
      }
      const stroke = e.kind === "contradicts" ? "var(--color-coral)" : e.kind === "supersedes" || dup ? "var(--color-plum)" : e.kind === "suggested" ? "var(--color-accent)" : "var(--color-line-strong)";
      // An arrow ends at the target's edge, not its middle.
      let x2 = b.x;
      let y2 = b.y;
      if (arrows && e.kind === "link") {
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const r = drawnRadius(radiusFor(deg.get(e.target) ?? 0, byId.get(e.target)?.kind !== "note"), k) + 2 / k;
        x2 = b.x - ((b.x - a.x) / d) * r;
        y2 = b.y - ((b.y - a.y) / d) * r;
      }
      out.push(
        <line
          key={i}
          x1={a.x}
          y1={a.y}
          x2={x2}
          y2={y2}
          stroke={stroke}
          strokeWidth={e.kind === "link" ? 1.2 : 1}
          strokeDasharray={dup || shared ? "1 3" : e.kind === "suggested" ? "2 4" : e.inferred && e.kind !== "mention" ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
          markerEnd={arrows && e.kind === "link" ? "url(#dna-arrow)" : undefined}
          opacity={on ? (near ? 0.9 : 0.45) : 0.07}
        />,
      );
    });
    return (
      <>
        {quiet.length ? <path d={quiet.join("")} stroke="var(--color-line-strong)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={0.45} fill="none" /> : null}
        {out}
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, at, near, searching, matches, arrows, dupKeys, visible, deg, byId, k]);

  // The map around a note: each line says why, at its middle (lit ones only when something is highlighted).
  const edgeLabelLayer = useMemo(() => {
    if (large) return null;
    return edges.map((e, i) => {
      const text = (e as Partial<AroundEdge>).label;
      const a = at(e.source);
      const b = at(e.target);
      if (!text || !a || !b) return null;
      if (near && !(near.has(e.source) && near.has(e.target))) return null;
      return (
        <text key={i} aria-hidden x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 3.5 / k} textAnchor="middle" fontSize={10.5 / k} fill="var(--color-ink-muted)" style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3 / k }}>
          {text}
        </text>
      );
    });
  }, [edges, at, near, k, large]);

  // Suggested links: dashed accent lines, each a wide invisible line that takes clicks.
  const suggestLayer = useMemo(
    () =>
      compact
        ? null
        : suggested.map((s) => {
            const a = at(s.source);
            const b = at(s.target);
            if (!a || !b || !shows(s.source) || !shows(s.target)) return null;
            const on = !near || (near.has(s.source) && near.has(s.target));
            return (
              <g key={`${s.source}:${s.target}`} data-suggestion={`${s.source}:${s.target}`} opacity={on ? 0.8 : 0.1}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-accent)" strokeWidth={1.2} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={12}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    const r = wrap.current!.getBoundingClientRect();
                    setOffer({ ...s, x: e.clientX - r.left, y: e.clientY - r.top });
                  }}
                />
              </g>
            );
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggested, at, near, visible, compact],
  );

  // Clusters: a faint wash behind each; its name above it is drawn after the nodes (so no dot covers it) and kept
  // clear of the notes' labels.
  const clusterShapes = useMemo(() => {
    if (!clusters) return [];
    return clusters.clusters.slice(0, 12).flatMap((c) => {
      const circle = clusterCircle(c.members.map((m) => at(m)).filter((p): p is Point => Boolean(p)));
      return circle ? [{ id: c.id, name: c.name, ...circle, tint: CLUSTER_TINTS[c.id % CLUSTER_TINTS.length] }] : [];
    });
  }, [clusters, at]);
  const clusterLayer = clusterShapes.map((c) => <circle key={c.id} aria-hidden cx={c.x} cy={c.y} r={c.r} fill={c.tint} opacity={0.06} />);
  const clusterNames = compact
    ? null
    : clusterShapes.map((c) => (
        <text key={c.id} aria-hidden x={c.x} y={c.y - c.r - 6 / k} textAnchor="middle" fontSize={12 / k} fontWeight={600} fill={c.tint} opacity={0.9} style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3 / k }}>
          {c.name}
        </text>
      ));

  // Which nodes are labelled: every one whose label has room (it was the 12 best-connected, and most notes were
  // bare dots). Worked out in screen pixels on the view as it rests (not on every frame of a pan).
  const [restT, setRestT] = useState(t);
  useEffect(() => {
    const id = setTimeout(() => setRestT(t), 120);
    return () => clearTimeout(id);
  }, [t]);
  const labels = useMemo(() => {
    const always = new Set<string>([...(near ?? []), ...(searching ? matches : []), ...(center ? [center] : [])]);
    if (large) return new Set([...labelled, ...always]);
    const { x, y, k: kk } = restT;
    const screen = (id: string) => {
      const p = at(id);
      return p ? { x: p.x * kk + x, y: p.y * kk + y } : null;
    };
    const order = nodes
      .filter((n) => shows(n.id))
      .sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || a.label.localeCompare(b.label))
      .map((n) => n.id);
    const blocked = compact ? [] : clusterShapes.map((c) => ({ x: (c.x - c.name.length * 3.6 / kk) * kk + x, y: (c.y - c.r) * kk + y - 22, w: c.name.length * 7.2, h: 16 }));
    return labelPlan(order, {
      always,
      // Fewer labels zoomed out (they only crowded each other), every one with room zoomed in.
      limit: always.size + labelBudget(kk, order.length),
      // Hubs may sit beside another dot only while the map is near full size (on a phone their labels collided).
      preferred: kk >= 0.7 ? labelled : undefined,
      bounds: size.w > 0 && size.h > 0 ? { x: 4, y: 4, w: size.w - 8, h: size.h - 8 } : undefined,
      blocked,
      center: screen,
      radius: (id) => drawnRadius(radiusFor(deg.get(id) ?? 0, byId.get(id)?.kind !== "note"), kk) * kk,
      width: (id) => labelWidth(shortLabel(byId.get(id)?.label ?? "")),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restT, size.w, size.h, nodes, deg, at, near, searching, matches, center, labelled, large, clusterShapes, compact, visible, byId]);

  // Nodes depend on the zoom (their minimum size and label size), not on panning.
  const nodeLayer = useMemo(
    () =>
      nodes.map((n) => {
        const p = at(n.id);
        if (!p || !shows(n.id)) return null;
        const entity = n.kind !== "note";
        const d = deg.get(n.id) ?? 0;
        const r = drawnRadius(radiusFor(d, entity), k);
        const on = near ? near.has(n.id) : searching ? matches.has(n.id) : true;
        const showLabel = on && labels.has(n.id);
        const path = shapePath(n.kind, r);
        const isPicked = picked.has(n.id);
        const outline = n.id === selected || isPicked ? "var(--color-heading)" : "var(--color-canvas)";
        const fill = colorFor ? colorFor(n as DnaNode) : (KIND_COLOR[n.kind] ?? KIND_COLOR.note);
        return (
          <g
            key={n.id}
            ref={(el) => {
              if (el) nodeEls.current.set(n.id, el);
              else nodeEls.current.delete(n.id);
            }}
            data-node={n.id}
            role="button"
            tabIndex={n.id === tabStop ? 0 : -1}
            aria-label={nodeLabel(n, d)}
            aria-expanded={entity ? n.id === selected : undefined}
            aria-pressed={isPicked || undefined}
            transform={`translate(${p.x} ${p.y})`}
            opacity={on ? 1 : dimTo}
            onPointerEnter={() => setHover(n.id)}
            onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
            onFocus={(e) => {
              setFocused(n.id);
              setStop(n.id);
              let visibleRing = true;
              try {
                visibleRing = e.currentTarget.matches(":focus-visible");
              } catch {
                /* older engines: always show it */
              }
              setRing(visibleRing);
            }}
            onBlur={() => setFocused((f) => (f === n.id ? null : f))}
            className="cursor-pointer outline-none"
          >
            {/* A target that's easy to hit, whatever the zoom. */}
            {!large || on ? <circle r={hitRadius(r, k)} fill="transparent" /> : null}
            {fresh?.has(n.id) ? <circle r={r + 5 / k} fill="var(--color-marigold)" opacity={0.35} /> : null}
            {bridges?.has(n.id) ? <circle r={r + 3 / k} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" /> : null}
            {n.id === focused && ring ? <circle r={r + 4 / k} fill="none" stroke="var(--color-focus)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" /> : null}
            {path ? (
              <path d={path} fill={fill} stroke={outline} strokeWidth={isPicked ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" />
            ) : (
              <circle r={r} fill={fill} stroke={outline} strokeWidth={isPicked ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" />
            )}
            {pins.has(n.id) ? <circle r={2 / k} cy={-r - 3 / k} fill="var(--color-heading)" /> : null}
            {showLabel && n.id !== hover && n.id !== focused ? (
              <text y={r + 12 / k} textAnchor="middle" fontSize={11.5 / k} fill="var(--color-ink)" style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3 / k }}>
                {shortLabel(n.label)}
              </text>
            ) : null}
          </g>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, at, deg, k, near, searching, matches, labels, selected, tabStop, hover, focused, ring, colorFor, picked, fresh, bridges, pins, visible, dimTo, large, center],
  );

  // The hovered or focused node's name and what it does, next to it.
  const tipId = compact ? null : (hover ?? focused);
  const tip = tipId ? byId.get(tipId) : null;
  const tipAt = tipId && at(tipId) ? toScreen(t, at(tipId)!) : null;
  const entityPicked = selected ? byId.get(selected) : null;
  const pickedNotes = useMemo(
    () =>
      selected
        ? [...neighbours(edges, selected)]
            .map((id) => byId.get(id))
            .filter((n): n is GraphNodeData => n?.kind === "note")
            .sort((a, b) => a.label.localeCompare(b.label))
        : [],
    [selected, edges, byId],
  );
  const noteCount = nodes.filter((n) => n.kind === "note").length;
  const laidOut = positions.size > 0;
  // A map with hardly anything in it: say how it fills up.
  const sparse = compact ? null : sparseProp !== undefined ? sparseProp : noteCount < 3 ? "Foli DNA grows as you write. Notes show up here, and lines join the ones that link to each other." : !edges.length ? "None of these notes link to each other yet. Type [[ in a note to link another one, and a line joins them here." : null;
  const closePicked = () => {
    const id = selected;
    setSelected(null);
    if (id) nodeEls.current.get(id)?.focus();
  };
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={wrap}
        role="application"
        aria-roledescription="graph"
        aria-label={`Foli DNA of ${noteCount} notes and ${nodes.length - noteCount} people, projects and topics. Arrow keys move between them, Enter opens a note or shows an entity's notes${onSelect ? ", Space says why a note is connected" : ""}, Shift and the arrow keys pan, plus and minus zoom, 0 fits. The List view shows the same map as text.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden outline-none active:cursor-grabbing"
      >
        <svg width="100%" height="100%" className="block">
          <defs>
            <marker id="dna-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill="var(--color-line-strong)" />
            </marker>
          </defs>
          <g transform={`translate(${t.x} ${t.y}) scale(${k})`}>
            {clusterLayer}
            <g aria-hidden>{edgeLayer}</g>
            {suggestLayer}
            {edgeLabelLayer}
            {nodeLayer}
            {clusterNames}
          </g>
          {box ? <rect x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)} width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} fill="var(--color-accent)" opacity={0.08} stroke="var(--color-accent)" /> : null}
        </svg>
      </div>
      {!laidOut ? (
        <p role="status" className="pointer-events-none absolute inset-0 m-auto h-fit text-center text-subheadline text-muted">
          Laying out Foli DNA…
        </p>
      ) : null}
      {laidOut && sparse ? <p className="pointer-events-none absolute left-3 top-3 z-10 max-w-[min(340px,calc(100%-80px))] rounded-control bg-[var(--glass-hover)] px-3 py-2 text-subheadline leading-snug text-muted">{sparse}</p> : null}
      {playLabel ? (
        <p role="status" className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-control bg-[var(--glass-hover)] px-3 py-1 text-subheadline tabular-nums text-heading">
          {playLabel}
        </p>
      ) : null}
      {tip && tipAt ? (
        <div role="tooltip" className="ui-pop pointer-events-none absolute z-10 max-w-[240px] -translate-x-1/2 rounded-control px-2.5 py-1.5 text-subheadline" style={{ left: tipAt.x, top: tipAt.y + 16 }}>
          <span className="font-medium text-heading">{tip.label || "Untitled"}</span>
          <span className="block text-footnote text-muted">
            {tip.kind === "note"
              ? tipId === focused && !hover
                ? onSelect
                  ? "Enter opens it · Space says why it’s connected"
                  : "Enter opens it"
                : onSelect
                  ? pins.has(tip.id)
                    ? "Click to see why it’s connected · double-click to unpin"
                    : "Click to see why it’s connected · double-click to open"
                  : pins.has(tip.id)
                    ? "Click to open · double-click to unpin"
                    : "Click to open · drag to pin"
              : `${KIND_LABEL[tip.kind]} · ${tipId === focused && !hover ? "Enter shows its notes" : "Click for its notes"}`}
          </span>
        </div>
      ) : null}
      {offer ? <LinkOffer offer={offer} byId={byId} onDone={() => setOffer(null)} /> : null}
      {entityPicked && !onSelect ? (
        <section aria-label={entityPicked.label} className="ui-pop absolute bottom-3 left-3 z-10 w-[min(300px,calc(100%-24px))] rounded-panel p-3">
          <div className="flex items-start gap-2">
            <span className="mt-1">
              <KindGlyph kind={entityPicked.kind} />
            </span>
            <h2 className="min-w-0 flex-1 text-body font-semibold text-heading">
              {entityPicked.label} <span className="text-footnote font-normal text-faint">{KIND_LABEL[entityPicked.kind]}</span>
            </h2>
            <IconButton label="Close" onClick={closePicked} className="!h-7 !w-7 -mr-1 -mt-1">
              <X size={14} aria-hidden />
            </IconButton>
          </div>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
            {pickedNotes.map((n) => (
              <li key={n.id}>
                <AppLink href={`/d/${n.id}`} className="flex items-center gap-1.5 rounded-chip px-1.5 py-1 text-subheadline hover:bg-accent-soft">
                  <FileText size={13} aria-hidden className="flex-none text-muted" />
                  <span className="truncate">{n.label || "Untitled"}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {hidden && laidOut && !overlay?.bottomRight ? (
        <p className="absolute bottom-3 right-3 z-10 whitespace-nowrap rounded-control bg-[var(--glass-hover)] px-3 py-1 text-footnote text-muted">
          {hidden.count === 1 ? "1 unlinked note hidden." : `${hidden.count} unlinked notes hidden.`}{" "}
          <button type="button" onClick={hidden.show} className="text-heading underline underline-offset-2">
            Show
          </button>
        </p>
      ) : null}
      {overlay?.topCenter ? <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">{overlay.topCenter}</div> : null}
      {overlay?.bottomLeft && laidOut ? <div className="pointer-events-none absolute bottom-3 left-3 z-10">{overlay.bottomLeft}</div> : null}
      {overlay?.bottomRight ? <div className="pointer-events-none absolute bottom-3 right-3 z-20">{overlay.bottomRight}</div> : null}
      {picked.size && !compact ? <SelectionBar ids={[...picked]} byId={byId} onClear={() => setPicked(new Set())} /> : null}
      {!compact ? (
        <div role="group" aria-label="Zoom" className="ui-pop absolute right-3 top-3 z-10 flex flex-col gap-0.5 rounded-panel p-1">
          <IconButton label="Zoom in" shortcut="+" onClick={() => zoomBy(1.25)}>
            <ZoomIn size={15} aria-hidden />
          </IconButton>
          <IconButton label="Zoom out" shortcut="-" onClick={() => zoomBy(0.8)}>
            <ZoomOut size={15} aria-hidden />
          </IconButton>
          <IconButton label="Fit to screen" shortcut="0" onClick={refit}>
            <Maximize size={15} aria-hidden />
          </IconButton>
          {focus ? (
            <IconButton label="Go to the highlighted note" onClick={() => glideTo(focus)}>
              <Focus size={15} aria-hidden />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A suggested link's offer, by its dashed line: link the two notes, or not now. */
function LinkOffer({ offer, byId, onDone }: { offer: { source: string; target: string; entities: string[]; x: number; y: number }; byId: Map<string, GraphNodeData>; onDone: () => void }) {
  const link = useMutation(api.aiGraph.linkNote);
  const toast = useToast();
  return (
    <section aria-label="Suggested link" className="ui-pop absolute z-20 w-[min(280px,calc(100%-24px))] -translate-x-1/2 rounded-panel p-3 text-subheadline" style={{ left: offer.x, top: offer.y + 12 }}>
      <p className="text-heading">
        Link <strong>{byId.get(offer.source)?.label || "Untitled"}</strong> to <strong>{byId.get(offer.target)?.label || "Untitled"}</strong>?
      </p>
      <p className="mt-0.5 text-footnote text-muted">Both mention {offer.entities.join(", ")}. A “Related:” line goes at the end of the first note.</p>
      <div className="mt-2 flex gap-2">
        <Button
          onClick={async () => {
            onDone();
            try {
              await link({ documentId: offer.source, targetId: offer.target });
              toast.show("Linked");
            } catch (e) {
              toast.show(errorMessage(e), { tone: "error" });
            }
          }}
        >
          Link them
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Not now
        </Button>
      </div>
    </section>
  );
}

/** The bar for notes picked on the map (Shift-click, Shift-drag): move, bookmark, tag, ask Foli AI. */
function SelectionBar({ ids, byId, onClear }: { ids: string[]; byId: Map<string, GraphNodeData>; onClear: () => void }) {
  const notesApi = useNoteActions();
  const { openAsk } = useShell();
  const { scope } = useAppState();
  const tree = useFolderTree(scope);
  const setTags = useMutation(api.organization.setDocumentTags);
  const toast = useToast();
  const ask = () => openAsk(`What connects these notes, and what do they add up to? ${ids.map((id) => byId.get(id)?.label || "Untitled").join(", ")}.`);
  const addTag = async (tagId: string) => {
    const name = tree?.tags.find((x) => x.id === tagId)?.name ?? "the tag";
    let done = 0;
    for (const id of ids) {
      const cur = (byId.get(id) as DnaNode | undefined)?.tagIds ?? [];
      if (cur.includes(tagId)) continue;
      try {
        await setTags({ documentId: id, tagIds: [...cur, tagId] });
        done++;
      } catch (e) {
        toast.show(errorMessage(e), { tone: "error" });
        return;
      }
    }
    toast.show(done === 1 ? `Tagged 1 note #${name}` : `Tagged ${done} notes #${name}`);
  };
  return (
    <div role="toolbar" aria-label="Selected notes" className="ui-pop absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center gap-1 rounded-panel px-2 py-1.5 text-subheadline">
      <span className="px-1.5 tabular-nums text-heading">{ids.length === 1 ? "1 note" : `${ids.length} notes`}</span>
      <MenuButton
        label="Move to folder"
        trigger={
          <span className="inline-flex items-center gap-1 px-1">
            <FolderInput size={14} aria-hidden /> Move
          </span>
        }
        side="top"
        items={[{ label: "Drafts (no folder)", onSelect: () => void notesApi.moveTo(ids, { id: null, name: "Drafts" }) }, ...(tree?.folders ?? []).map((f) => ({ label: f.name, onSelect: () => void notesApi.moveTo(ids, { id: f.id, name: f.name }) }))]}
      />
      <Button variant="quiet" className="!h-8 !px-2" onClick={() => void notesApi.star(ids, true)}>
        <Bookmark size={14} aria-hidden /> Bookmark
      </Button>
      {tree?.tags.length ? (
        <MenuButton
          label="Add a tag"
          trigger={
            <span className="inline-flex items-center gap-1 px-1">
              <TagIcon size={14} aria-hidden /> Tag
            </span>
          }
          side="top"
          items={tree.tags.map((tg) => ({ label: `#${tg.name}`, onSelect: () => void addTag(tg.id) }))}
        />
      ) : null}
      <Button variant="quiet" className="!h-8 !px-2" onClick={ask}>
        <Sparkles size={14} aria-hidden /> Ask Foli AI
      </Button>
      <IconButton label="Clear selection" onClick={onClear} className="!h-8 !w-8">
        <X size={14} aria-hidden />
      </IconButton>
    </div>
  );
}

/**
 * The Inspector's Foli DNA: a small live map of the open note and what it's joined to (one step), with a link to
 * the full page around it.
 */
export function DnaMini({ documentId }: { documentId: string }) {
  const { scope } = useAppState();
  const { navigate } = useAppRouter();
  // The note goes along, so it is in the map however long ago it was edited.
  const live = useQuery(api.aiGraph.graph, { scope, center: documentId }) as GraphData | undefined;
  const around = useMemo(() => (live ? localGraph(live.nodes, live.edges, documentId, 1) : null), [live, documentId]);
  if (!live) return <p className="text-footnote text-muted">Loading Foli DNA…</p>;
  if (!around?.nodes.length) return <p className="text-footnote text-muted">This note isn’t in Foli DNA yet. Link it to another note with [[ and it shows here.</p>;
  return (
    <div>
      <div className="relative h-56 overflow-hidden rounded-control border border-line">
        <GraphCanvas nodes={around.nodes} edges={around.edges} matches={new Set()} searching={false} onOpen={(id, newTab) => (newTab && openNextInNewTab(), navigate(`/d/${id}`))} center={documentId} compact />
      </div>
      <p className="mt-1.5 flex items-center justify-between text-footnote text-muted">
        <span>
          {around.nodes.length - 1} {around.nodes.length - 1 === 1 ? "connection" : "connections"}
        </span>
        <AppLink href={`/graph?note=${documentId}`} className="text-heading underline-offset-2 hover:underline">
          Open in Foli DNA
        </AppLink>
      </p>
    </div>
  );
}
