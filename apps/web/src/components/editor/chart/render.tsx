// The chart drawn without editing: read-only notes, share pages, version history. For now its title, its
// data as a table and the takeaway; the chart build draws the chart itself here.
import { chartCellText, parseChart } from "@folevi/editor-schema";

export function ChartStatic({ data }: { data: string; height?: number }) {
  const chart = parseChart(data);
  if (!chart.columns.length) return <p className="fb-vc-static-empty">Empty chart</p>;
  return (
    <figure className="fb-chart-table">
      {chart.title ? <figcaption>{chart.title}</figcaption> : null}
      <div className="fb-hscroll">
        <table>
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
                {r.map((c, j) => (
                  <td key={j} data-number={typeof c === "number" || undefined}>
                    {chartCellText(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chart.takeaway ? <p>{chart.takeaway}</p> : null}
    </figure>
  );
}
