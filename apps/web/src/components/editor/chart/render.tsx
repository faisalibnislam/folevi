// The chart drawn without editing: read-only notes, share pages, version history. Its title, the chart
// itself (the same drawing as the editor's, fitted to the page's width), the takeaway, and its data as a
// table (behind "Show data"; screen readers get the table either way). No hooks, so it renders on the server.
import { chartCellText, parseChart, type ChartData } from "@folevi/editor-schema";
import { drawChart } from "./draw";
import { ChartSvg } from "./ChartSvg";

/** How wide the read-only drawing is laid out (it scales down to narrower pages). */
const STATIC_WIDTH = 720;

/** The chart's data as a table: the editor's screen-reader copy and the read-only "Show data". */
export function ChartTable({ chart, id, className }: { chart: ChartData; id?: string; className?: string }) {
  return (
    <table id={id} className={className}>
      <thead>
        <tr>
          {chart.columns.map((c, i) => (
            <th key={i} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {chart.rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {chartCellText(c)}
                </th>
              ) : (
                <td key={j} data-number={typeof c === "number" || undefined}>
                  {chartCellText(c)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Takeaway text: one paragraph, or a list when Foli AI (or you) wrote it line by line. */
export function Takeaway({ text, className }: { text: string; className?: string }) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  if (!lines.length) return null;
  if (lines.length === 1) return <p className={className}>{lines[0]}</p>;
  return (
    <ul className={className}>
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

export function ChartStatic({ data, height }: { data: string; height?: number }) {
  const chart = parseChart(data);
  if (!chart.columns.length) return <p className="fb-vc-static-empty">Empty chart</p>;
  const h = Math.max(200, Math.min(1200, Number(height) || 360) - 40);
  const scene = drawChart(chart, { width: STATIC_WIDTH, height: h });
  return (
    <figure className="fb-chart-static fb-chart-root">
      {chart.title ? <figcaption className="fb-chart-static-title">{chart.title}</figcaption> : null}
      {scene.empty ? (
        <p className="fb-vc-static-empty">{scene.summary}</p>
      ) : (
        <div className="fb-chart-static-plot">
          <ChartSvg scene={scene} fit />
        </div>
      )}
      {chart.takeaway ? <Takeaway text={chart.takeaway} className="fb-chart-takeaway" /> : null}
      <details className="fb-chart-data">
        <summary>Show data</summary>
        <div className="fb-hscroll">
          <ChartTable chart={chart} />
        </div>
      </details>
    </figure>
  );
}
