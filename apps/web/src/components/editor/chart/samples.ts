// Sample data for each kind of chart: what "Start with an example" fills in, so a new chart shows how its
// table is read (categories and series, points, slices, people, sets and overlaps).
import { emptyChart, type ChartData, type ChartKind } from "@folevi/editor-schema";

const MONTHS = { columns: ["Month", "Web", "iPhone"], rows: [["Jan", 120, 40], ["Feb", 150, 62], ["Mar", 310, 90], ["Apr", 280, 132]] };

const SAMPLES: Record<ChartKind, { title: string; columns: string[]; rows: (string | number)[][] }> = {
  bar: { title: "Sign ups by month", ...MONTHS },
  stackedBar: { title: "Sign ups by month", ...MONTHS },
  line: { title: "Sign ups by month", ...MONTHS },
  area: { title: "Sign ups by month", ...MONTHS },
  pie: { title: "Where visitors come from", columns: ["Channel", "Visitors"], rows: [["Search", 4200], ["Social", 2100], ["Email", 1300], ["Direct", 900]] },
  donut: { title: "Where visitors come from", columns: ["Channel", "Visitors"], rows: [["Search", 4200], ["Social", 2100], ["Email", 1300], ["Direct", 900]] },
  scatter: { title: "Hours and tasks done", columns: ["Person", "Hours", "Tasks done"], rows: [["Ana", 32, 18], ["Ben", 40, 21], ["Chi", 24, 15], ["Dev", 36, 26], ["Eli", 18, 9], ["Fay", 28, 20]] },
  bubble: { title: "Markets by growth and margin", columns: ["Market", "Growth (%)", "Margin (%)", "Revenue"], rows: [["North", 4, 22, 120], ["South", 9, 15, 80], ["East", 14, 11, 45], ["West", 6, 28, 150]] },
  org: { title: "Team", columns: ["Name", "Reports to", "Role"], rows: [["Ada", "", "Founder"], ["Grace", "Ada", "Engineering"], ["Alan", "Ada", "Design"], ["Linus", "Grace", "Developer"], ["Margaret", "Grace", "Developer"], ["Susan", "Alan", "Designer"]] },
  venn: { title: "Skills on the team", columns: ["Set", "People"], rows: [["Design", 12], ["Code", 18], ["Writing", 9], ["Design & Code", 5], ["Code & Writing", 3], ["Design & Writing", 4], ["Design & Code & Writing", 2]] },
};

/** A chart of `kind` filled with its example. */
export function sampleChart(kind: ChartKind): ChartData {
  const s = SAMPLES[kind];
  return { ...emptyChart(), kind, title: s.title, columns: [...s.columns], rows: s.rows.map((r) => [...r]) };
}

/** An empty table for `kind`: its columns named, a few blank rows to type into. */
export function blankChart(kind: ChartKind): ChartData {
  const s = SAMPLES[kind];
  return { ...emptyChart(), kind, columns: [...s.columns], rows: Array.from({ length: 3 }, () => s.columns.map(() => null)) };
}
