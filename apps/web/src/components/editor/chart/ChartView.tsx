"use client";

// Chart block: bar (grouped or stacked), line, area, pie and donut, scatter and bubble, org chart and Venn,
// from a small table of values. The content lives in the block's `data` (packages/editor-schema/src/chart.ts).
//
// The card, its toolbar, Full canvas (⇧⌘F, Esc back), Export (PNG, SVG, PDF, Copy as image; ./svg.ts) and
// the height handle come from canvas/CanvasCard.tsx. In the toolbar: the chart type (switch any time), Data
// (its table, edited in place), Data from (its own table, a table in this note, a collection, CSV or pasted
// rows), Style (colors, legend, labels, order, axes) and Foli AI. Under the toolbar: the title, the chart
// (ChartCanvas: hover, tap or arrow keys for tooltips) and the takeaway line.
import type { ReactNodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Blend,
  ChartArea,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartPie,
  ChartScatter,
  ChevronDown,
  Circle,
  CircleDot,
  Database,
  Network,
  Palette,
  Table2,
} from "lucide-react";
import {
  CHART_DEFAULT_HEIGHT,
  CHART_KINDS,
  CHART_KIND_LABEL,
  LIMITS,
  parseChart,
  serializeChart,
  type ChartData,
  type ChartKind,
  type ChartSource,
} from "@folevi/editor-schema";
import { useAiEnabled, useNoteAi } from "@/components/ai/useAi";
import { AiIcon } from "@/components/ai/AiIcon";
import { MenuButton } from "@/components/ui/Menu";
import { Popover } from "@/components/ui/Popover";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/nativeApp";
import { CanvasCard } from "../canvas/CanvasCard";
import { useEditorEnvironment } from "../environment";
import { useEditable } from "../useEditable";
import { ChartCanvas, type ChartCanvasHandle } from "./ChartCanvas";
import { ChartAiPanel, applyPatch, useChartAi } from "./ChartAi";
import { DataGrid, type GridData } from "./DataGrid";
import { drawChart } from "./draw";
import { takeStyleRequest } from "./fromTable";
import { CollectionFeed, useTableSource } from "./LiveSources";
import { ChartTable, Takeaway } from "./render";
import { blankChart, sampleChart } from "./samples";
import { sameRows, type ChartRows } from "./sources";
import { SourcePanel } from "./SourcePanel";
import { StylePanel } from "./StylePanel";

const KIND_ICON: Record<ChartKind, React.ReactNode> = {
  bar: <ChartColumn size={14} aria-hidden />,
  stackedBar: <ChartColumnStacked size={14} aria-hidden />,
  line: <ChartLine size={14} aria-hidden />,
  area: <ChartArea size={14} aria-hidden />,
  pie: <ChartPie size={14} aria-hidden />,
  donut: <CircleDot size={14} aria-hidden />,
  scatter: <ChartScatter size={14} aria-hidden />,
  bubble: <Circle size={14} aria-hidden />,
  org: <Network size={14} aria-hidden />,
  venn: <Blend size={14} aria-hidden />,
};

/** How tall the card gets while its data table is open in the note. */
const GRID_HEIGHT = 600;

/** The room under the toolbar the chart is drawn in, kept current as the card resizes. */
function useRoom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setRoom((r) =>
        Math.abs(r.w - el.clientWidth) < 1 && Math.abs(r.h - el.clientHeight) < 1
          ? r
          : { w: el.clientWidth, h: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [
    ref,
    room,
    () => ref.current && setRoom({ w: ref.current.clientWidth, h: ref.current.clientHeight }),
  ] as const;
}

/** A text field that keeps what's typed while it has focus and saves as you go. */
function InlineField({
  value,
  onChange,
  label,
  placeholder,
  className,
  multiline,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
  className: string;
  multiline?: boolean;
  maxLength: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = draft ?? value;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    // Hidden (an empty chart's body) it measures nothing: CSS keeps one line then.
    el.style.height = el.scrollHeight ? `${el.scrollHeight}px` : "";
  }, [shown]);
  const common = {
    value: shown,
    "aria-label": label,
    placeholder,
    maxLength,
    className,
    onFocus: () => setDraft(value),
    onBlur: () => setDraft(null),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape")
        (e.currentTarget.closest(".fb-canvas-body") as HTMLElement | null)?.focus();
      if (e.key === "Enter" && !multiline) {
        e.preventDefault();
        (e.currentTarget as HTMLElement).blur();
      }
    },
  };
  if (multiline)
    return (
      <textarea
        ref={ref}
        rows={1}
        {...common}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
      />
    );
  return (
    <input
      {...common}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value.replace(/\n+/g, " "));
      }}
    />
  );
}

/**
 * Keys inside a panel stay in it (the card would take Escape and the arrows); Escape closes the panel and
 * puts focus back on its button.
 */
function PanelKeys({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

export function ChartView(props: ReactNodeViewProps) {
  const { node, editor, getPos } = props;
  const data = String(node.attrs.data ?? "");
  const stored = useMemo(() => parseChart(data), [data]);
  const editable = useEditable(editor);
  const env = useEditorEnvironment();
  const aiOn = useAiEnabled() && !env.demo;
  const noteAi = useNoteAi();
  const documentId = env.demo ? undefined : (noteAi?.home?.id ?? undefined);
  const toast = useToast();
  const chartAi = useChartAi();
  const tableId = useId();
  const canvas = useRef<ChartCanvasHandle>(null);
  const [gridOpen, setGridOpenState] = useState(false);
  // Opening the data table in the note makes a short card taller (and closing it puts it back).
  const grewFrom = useRef<number | null>(null);
  const setHeight = useCallback(
    (h: number) => {
      const pos = typeof getPos === "function" ? getPos() : null;
      const cur = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
      if (!cur || cur.type.name !== "chart" || !editor.isEditable) return;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos!, undefined, { ...cur.attrs, height: h }).setMeta("addToHistory", false));
    },
    [editor, getPos],
  );
  const setGridOpen = (open: boolean | ((was: boolean) => boolean)) =>
    setGridOpenState((was) => {
      const next = typeof open === "function" ? open(was) : open;
      if (next === was) return was;
      const h = Number(node.attrs.height) || CHART_DEFAULT_HEIGHT;
      if (next && h < GRID_HEIGHT) {
        grewFrom.current = h;
        queueMicrotask(() => setHeight(GRID_HEIGHT));
      } else if (!next && grewFrom.current !== null) {
        const back = grewFrom.current;
        grewFrom.current = null;
        if (h === GRID_HEIGHT) queueMicrotask(() => setHeight(back));
      }
      return next;
    });
  const [panel, setPanel] = useState<"source" | "style" | "ai" | null>(null);
  const sourceBtn = useRef<HTMLButtonElement>(null);
  const styleBtn = useRef<HTMLButtonElement>(null);
  const aiBtn = useRef<HTMLButtonElement>(null);
  // Rows from a live source as they are now (shown at once; saved with the chart when you can edit it).
  const [live, setLive] = useState<{ source: string; rows: ChartRows } | null>(null);
  const [collectionMissing, setCollectionMissing] = useState(false);
  const sourceKey = stored.source ? JSON.stringify(stored.source) : "";
  const chart = useMemo<ChartData>(
    () =>
      live && live.source === sourceKey
        ? { ...stored, columns: live.rows.columns, rows: live.rows.rows }
        : stored,
    [stored, live, sourceKey],
  );
  const chartRef = useRef(chart);
  useLayoutEffect(() => {
    chartRef.current = chart;
  });

  /** Saves the chart as one change to this block (`history: false` for copies from a live source). */
  const write = useCallback(
    (next: ChartData, history = true) => {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos !== "number" || !editor.isEditable) return;
      const cur = editor.state.doc.nodeAt(pos);
      if (!cur || cur.type.name !== "chart") return;
      const nextData = serializeChart(next);
      if (nextData === cur.attrs.data) return;
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, data: nextData });
      if (!history) tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    },
    [editor, getPos],
  );
  const update = useCallback(
    (patch: Partial<ChartData>) => write({ ...chartRef.current, ...patch }),
    [write],
  );

  // Live sources keep the saved rows current.
  const onLiveRows = useCallback(
    (rows: ChartRows) => {
      const cur = chartRef.current;
      setLive({ source: cur.source ? JSON.stringify(cur.source) : "", rows });
      const pos = typeof getPos === "function" ? getPos() : null;
      const saved = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
      if (!saved || saved.type.name !== "chart") return;
      const was = parseChart(String(saved.attrs.data ?? ""));
      if (!sameRows(rows, was)) write({ ...was, columns: rows.columns, rows: rows.rows }, false);
    },
    [write, editor, getPos],
  );
  const table = useTableSource(editor, stored.source, onLiveRows);
  useEffect(() => setCollectionMissing(false), [sourceKey]);

  const setSource = (source: ChartSource | null, rows?: ChartRows) => {
    setLive(rows && source ? { source: JSON.stringify(source), rows } : null);
    write({
      ...chartRef.current,
      source,
      ...(rows ? { columns: rows.columns, rows: rows.rows } : {}),
    });
    setPanel(null);
  };

  // A chart just made from a table asks Foli AI for its title and takeaway, once.
  const askedStyle = useRef(false);
  useEffect(() => {
    const id = String(node.attrs.id ?? "");
    if (askedStyle.current || !id || !takeStyleRequest(id)) return;
    askedStyle.current = true;
    if (!aiOn || !editable) return;
    const before = chartRef.current;
    chartAi
      .assist("title", serializeChart(before), documentId)
      .then((p) => {
        const now = chartRef.current;
        write(
          applyPatch(now, {
            title: now.title ? undefined : p.title,
            takeaway: now.takeaway ? undefined : p.takeaway,
          }),
        );
      })
      .catch(() => toast.show("Foli AI couldn't write a title for the chart this time."));
  }, [node.attrs.id, aiOn, editable, chartAi, documentId, write, toast]);

  const [plotRef, room, remeasure] = useRoom<HTMLDivElement>();
  const scene = useMemo(
    () => (room.w > 40 && room.h > 40 ? drawChart(chart, { width: room.w, height: room.h }) : null),
    [chart, room.w, room.h],
  );
  const hasData = chart.columns.length > 0;
  const empty = !hasData && !chart.source;

  const closePanel = (anchor: React.RefObject<HTMLButtonElement | null>) => {
    setPanel(null);
    anchor.current?.focus();
  };

  const pickKind = (kind: ChartKind) => {
    haptic("light");
    if (!hasData) write(sampleChart(kind));
    else update({ kind });
  };

  const sourceNote =
    chart.source?.type === "table" ? (
      table.missing ? (
        <>
          <span>The table this chart followed was deleted. It shows the last numbers it had.</span>
          {editable ? (
            <button type="button" className="fb-chart-link" onClick={() => setSource(null)}>
              Keep them as its own data
            </button>
          ) : null}
        </>
      ) : (
        <>
          <span>
            {`From table ${table.n || ""} in this note. Edit the table to change the chart.`.replace(
              "  ",
              " ",
            )}
          </span>
          {editable ? (
            <button type="button" className="fb-chart-link" onClick={() => setSource(null)}>
              Use its own data instead
            </button>
          ) : null}
        </>
      )
    ) : chart.source?.type === "collection" ? (
      <>
        <span>
          {collectionMissing
            ? "The collection can't be read any more. The chart shows the last numbers it had."
            : "From a collection, kept up to date."}
        </span>
        {editable ? (
          <button type="button" className="fb-chart-link" onClick={() => setSource(null)}>
            {collectionMissing ? "Keep them as its own data" : "Use its own data instead"}
          </button>
        ) : null}
      </>
    ) : null;

  const tools = (
    <>
      {editable ? (
        <MenuButton
          label="Chart type"
          triggerClassName="fb-vc-btn fb-chart-kind-btn"
          trigger={
            <>
              {KIND_ICON[chart.kind]}
              <span className="fb-chart-tool-label">{CHART_KIND_LABEL[chart.kind]}</span>
              <ChevronDown size={12} aria-hidden />
            </>
          }
          items={CHART_KINDS.map((k) => ({
            label: CHART_KIND_LABEL[k],
            icon: KIND_ICON[k],
            checked: k === chart.kind,
            onSelect: () => pickKind(k),
          }))}
        />
      ) : null}
      <button
        type="button"
        className="fb-vc-btn"
        aria-pressed={gridOpen}
        disabled={empty}
        aria-label="Data" title="Show the chart's data"
        onClick={() => setGridOpen((o) => !o)}
      >
        <Table2 size={14} aria-hidden />
        <span className="fb-chart-tool-label">Data</span>
      </button>
      {editable ? (
        <>
          <button
            ref={sourceBtn}
            type="button"
            className="fb-vc-btn"
            aria-expanded={panel === "source"}
            aria-haspopup="dialog"
            aria-label="Data from" title="Where the numbers come from"
            onClick={() => setPanel((p) => (p === "source" ? null : "source"))}
          >
            <Database size={14} aria-hidden />
            <span className="fb-chart-tool-label">Data from</span>
          </button>
          <button
            ref={styleBtn}
            type="button"
            className="fb-vc-btn"
            aria-expanded={panel === "style"}
            aria-haspopup="dialog"
            disabled={empty}
            aria-label="Style" title="Colors, legend, labels and axes"
            onClick={() => setPanel((p) => (p === "style" ? null : "style"))}
          >
            <Palette size={14} aria-hidden />
            <span className="fb-chart-tool-label">Style</span>
          </button>
          {aiOn ? (
            <button
              ref={aiBtn}
              type="button"
              className="fb-vc-btn"
              aria-expanded={panel === "ai"}
              aria-haspopup="dialog"
              aria-label="Foli AI" title="Foli AI for this chart"
              onClick={() => setPanel((p) => (p === "ai" ? null : "ai"))}
            >
              <AiIcon size={14} />
              <span className="fb-chart-tool-label">Foli AI</span>
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );

  const hint = editable ? (
    <>
      <span className="fb-chart-hint-text">
        Add your numbers, or turn a table in this note into a chart.
      </span>
      <span className="fb-chart-hint-actions">
        <button
          type="button"
          className="ui-btn ui-btn-secondary h-8 px-3 text-[13px] pointer-coarse:h-11"
          onClick={() => write(sampleChart(chart.kind))}
        >
          Start with an example
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary h-8 px-3 text-[13px] pointer-coarse:h-11"
          onClick={() => {
            write(blankChart(chart.kind));
            setGridOpen(true);
          }}
        >
          Type the numbers
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-ghost h-8 px-3 text-[13px] pointer-coarse:h-11"
          onClick={() => setPanel("source")}
        >
          Use a table or file
        </button>
      </span>
    </>
  ) : (
    "Empty chart"
  );

  return (
    <CanvasCard
      view={props}
      type="chart"
      name="Chart"
      icon={<ChartColumn size={14} />}
      minHeight={LIMITS.minChartHeight}
      maxHeight={LIMITS.maxChartHeight}
      defaultHeight={CHART_DEFAULT_HEIGHT}
      empty={empty}
      hint={hint}
      tools={tools}
      onRefit={() => remeasure()}
      onKey={(e) => {
        if ((e.key === "ArrowRight" || e.key === "ArrowDown") && canvas.current?.step(1))
          return (e.preventDefault(), true);
        if ((e.key === "ArrowLeft" || e.key === "ArrowUp") && canvas.current?.step(-1))
          return (e.preventDefault(), true);
        if (e.key === "Escape" && canvas.current?.clear())
          return (e.preventDefault(), e.stopPropagation(), true);
        return false;
      }}
    >
      <div className="fb-chart-body" data-grid={(gridOpen && hasData) || undefined} hidden={empty}>
        <div className="fb-chart-main">
          {editable ? (
            <InlineField
              value={chart.title}
              onChange={(title) => update({ title })}
              label="Chart title"
              placeholder="Title"
              className="fb-chart-title"
              maxLength={200}
            />
          ) : chart.title ? (
            <p className="fb-chart-title">{chart.title}</p>
          ) : null}
          <div className="fb-chart-plot" ref={plotRef}>
            {scene && !scene.empty ? (
              <ChartCanvas ref={canvas} scene={scene} tableId={gridOpen ? undefined : tableId} />
            ) : scene ? (
              <div className="fb-chart-reason">
                <p>{scene.summary.replace(/^[^.]*\.\s*/, "")}</p>
                {editable ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary h-8 px-3 text-[13px] pointer-coarse:h-11"
                    onClick={() =>
                      write({
                        ...sampleChart(chart.kind),
                        title: chart.title || sampleChart(chart.kind).title,
                      })
                    }
                  >
                    Fill with an example
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {editable ? (
            <InlineField
              value={chart.takeaway}
              onChange={(takeaway) => update({ takeaway })}
              label="Takeaway"
              placeholder="Add a takeaway: what should people notice?"
              className="fb-chart-takeaway fb-chart-takeaway-field"
              multiline
              maxLength={500}
            />
          ) : chart.takeaway ? (
            <Takeaway text={chart.takeaway} className="fb-chart-takeaway" />
          ) : null}
        </div>
        {gridOpen && hasData ? (
          <DataGrid
            data={{ columns: chart.columns, rows: chart.rows }}
            kind={chart.kind}
            readOnly={!editable || Boolean(chart.source)}
            note={sourceNote}
            onChange={(next: GridData) => update({ columns: next.columns, rows: next.rows })}
          />
        ) : hasData ? (
          <ChartTable chart={chart} id={tableId} className="sr-only" />
        ) : null}
      </div>
      <CollectionFeed
        source={stored.source}
        onRows={onLiveRows}
        onMissing={() => setCollectionMissing(true)}
      />
      <Popover
        open={panel === "source"}
        onClose={() => setPanel(null)}
        anchor={sourceBtn}
        label="Where the chart's numbers come from"
        className="w-80"
      >
        <PanelKeys onClose={() => closePanel(sourceBtn)}>
          <SourcePanel
            chart={chart}
            editor={editor}
            demo={env.demo}
            onUnavailable={env.unavailable}
            onUseOwn={() => setSource(null)}
            onSource={(source, rows) => setSource(source, rows)}
            onRows={(rows) => {
              write({ ...chartRef.current, source: null, columns: rows.columns, rows: rows.rows });
              setLive(null);
              setPanel(null);
              setGridOpen(true);
            }}
          />
        </PanelKeys>
      </Popover>
      <Popover
        open={panel === "style"}
        onClose={() => setPanel(null)}
        anchor={styleBtn}
        label="Chart style"
        className="w-80"
      >
        <PanelKeys onClose={() => closePanel(styleBtn)}>
          <StylePanel chart={chart} onChange={update} />
        </PanelKeys>
      </Popover>
      {aiOn ? (
        <Popover
          open={panel === "ai"}
          onClose={() => setPanel(null)}
          anchor={aiBtn}
          label="Foli AI for this chart"
          className="w-80"
        >
          <PanelKeys onClose={() => closePanel(aiBtn)}>
            <ChartAiPanel
              chart={chart}
              data={serializeChart(chart)}
              documentId={documentId}
              onClose={() => setPanel(null)}
              onApply={(next) => {
                haptic("light");
                setLive(null);
                write(next);
              }}
            />
          </PanelKeys>
        </Popover>
      ) : null}
    </CanvasCard>
  );
}
