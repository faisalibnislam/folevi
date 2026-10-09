// Sharing, export and usage on the web (docs/AI_ASSISTANT.md milestone 9, part A): a conversation's share
// and export menu (Personal can't share, and says so), "Shared with you", a shared conversation read-only
// (no Stop, Regenerate, Approve or Undo; uploads as "File not shared"), the agent card read-only, the zip of
// every conversation, and the usage card with its day chart and table.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("convex/react", () => ({ useConvex: () => ({}), useAction: () => vi.fn(), useMutation: () => vi.fn(), useQuery: () => undefined }));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate: vi.fn() }), AppLink: (p: { children: ReactNode; href: string }) => <a href={p.href}>{p.children}</a> }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }), errorMessage: (e: unknown) => String((e as Error)?.message ?? e) }));
vi.mock("@/components/editor/richRender", () => ({ renderMermaid: vi.fn(async () => ({ error: "none" })), svgDataUrl: (svg: string) => svg, onThemeChange: () => () => {}, loadKatex: vi.fn(), renderLatex: vi.fn() }));

const { shareExportItems } = await import("@/components/ai/chat/ConversationActions");
const { SharedWithYou } = await import("@/components/ai/chat/ConversationList");
const { SharedThread } = await import("@/components/ai/chat/SharedThread");
const { AgentRunCard } = await import("@/components/ai/chat/AgentRunCard");
const { zipEntries } = await import("@/components/views/settings/AiExport");
const { UsageChart, UsageSummary } = await import("@/components/views/settings/AiUsage");
type SharedConversation = import("@/components/ai/chat/SharedThread").SharedConversation;
type AiUsageData = import("@/components/views/settings/AiUsage").AiUsageData;
type MenuItem = import("@/components/ui/Menu").MenuItem;

// An answer still being written reveals word by word (useTypewriter asks about reduced motion).
vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));

afterEach(() => {
  document.body.innerHTML = "";
});

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

const buttons = (host: HTMLElement) => [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
const handlers = () => ({ onShare: vi.fn(), onUnshare: vi.fn(), onCopy: vi.fn(), onDownload: vi.fn(), onSaveNote: vi.fn() });
const items = (entries: ReturnType<typeof shareExportItems>) => entries.filter((e): e is MenuItem => typeof e !== "string" && "label" in e);

describe("a conversation's share and export menu", () => {
  test("a workspace conversation: Share…, then Stop sharing once shared; copy, download, save as note", () => {
    const h = handlers();
    const list = items(shareExportItems({ id: "C1", title: "Plans", shared: false, workspace: true }, h));
    expect(list.map((i) => i.label)).toEqual(["Share with workspace…", "Copy as Markdown", "Download Markdown", "Save as note"]);
    expect(list.every((i) => !i.disabled)).toBe(true);
    list[0]!.onSelect();
    list[1]!.onSelect();
    list[2]!.onSelect();
    list[3]!.onSelect();
    expect([h.onShare, h.onCopy, h.onDownload, h.onSaveNote].every((f) => f.mock.calls.length === 1)).toBe(true);
    const shared = items(shareExportItems({ id: "C1", title: "Plans", shared: true, workspace: true }, h));
    expect(shared[0]!.label).toBe("Stop sharing");
    shared[0]!.onSelect();
    expect(h.onUnshare).toHaveBeenCalledOnce();
  });

  test("Personal can't share, and says so plainly; nor can a conversation that isn't kept", () => {
    const h = handlers();
    const personal = items(shareExportItems({ id: "C1", title: "Plans", shared: false, workspace: false }, h))[0]!;
    expect(personal).toMatchObject({ label: "Share with workspace", disabled: true, description: "Personal conversations can't be shared." });
    personal.onSelect();
    expect(h.onShare).not.toHaveBeenCalled();
    expect(items(shareExportItems({ id: "C1", title: "Plans", shared: false, workspace: true, ephemeral: true }, h))[0]).toMatchObject({ disabled: true, description: "History is off, so this one isn't kept." });
  });
});

describe("Shared with you", () => {
  test("lists conversations others shared, with who shared them, linking to each", () => {
    const { host } = render(<SharedWithYou activeId="S2" rows={[{ id: "S1", title: "Launch plan", by: "Ada", lastMessageAt: 1 }, { id: "S2", title: "Budget", by: "Grace", lastMessageAt: 2 }]} />);
    const section = host.querySelector('section[aria-label="Shared with you"]')!;
    expect(section.querySelector("p")!.textContent).toBe("Shared with you");
    const links = [...section.querySelectorAll("a")];
    expect(links.map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["/ai/S1", "Launch planAda"],
      ["/ai/S2", "BudgetGrace"],
    ]);
  });

  test("nothing shared: nothing shown", () => {
    expect(render(<SharedWithYou activeId={null} rows={[]} />).host.innerHTML).toBe("");
  });
});

const message = (over: Record<string, unknown>) => ({
  id: "m",
  role: "assistant",
  text: "",
  citations: [],
  webCitations: [],
  searchEntryPoints: [],
  actions: null,
  actionsOutcome: null,
  suggestions: [],
  status: "done",
  live: false,
  phase: null,
  error: null,
  credits: null,
  attachments: [],
  agent: null,
  memory: null,
  createdAt: 1,
  ...over,
});

const RUN = {
  id: "RUN1",
  status: "preview",
  executedAt: null,
  undoneAt: null,
  changed: null,
  operations: [{ id: "op1", kind: "rename_note", summary: "Rename “Plans”", status: "proposed", error: null, noteId: "N1", noteTitle: "Plans", title: "Trip", fromTitle: "Plans", folderName: null, fromFolderName: null, movesOut: false, markdown: null, edits: [], items: [], tags: [], sources: [], result: null, verified: null, undone: null }],
};

describe("a shared conversation, read-only", () => {
  test("who shared it, its messages and sources; uploads as 'File not shared'; nothing to act on", () => {
    const data = {
      conversation: { id: "C1", title: "Plans", by: "Ada", scope: { kind: "workspace", workspaceId: "W1" }, context: { kind: "workspace", items: [] }, sharedAt: 1, lastMessageAt: 1 },
      messages: [
        message({ id: "m1", role: "user", text: "What's planned?", attachments: [{ id: "x", name: "File not shared", mimeType: "", size: 0, kind: "file", shared: false }, { id: "f2", name: "plan.png", mimeType: "image/png", size: 10, kind: "image", shared: true }] }),
        message({ id: "m2", text: "The launch [1].", citations: [{ n: 1, noteId: "N1", title: "Launch plans" }], suggestions: ["Ask more?"], agent: { steps: [], run: RUN } }),
        message({ id: "m3", text: "", status: "streaming", phase: "writing" }),
      ],
    } as unknown as SharedConversation;
    const onCite = vi.fn();
    const { host } = render(<SharedThread data={data} onCite={onCite} onOpen={vi.fn()} />);
    expect(host.querySelector('[role="note"]')!.textContent).toBe("Shared by Ada. You can read it, but only they can ask in it.");
    expect(host.querySelector('ul[aria-label="Files not shared"]')!.textContent!.trim()).toBe("File not shared");
    expect(host.querySelector('ul[aria-label="Attached files"]')!.textContent).toContain("plan.png");
    expect(host.textContent).toContain("Launch plans");
    expect(host.textContent).toContain("Rename “Plans”");
    expect(host.textContent).toContain("Still being written…");
    const all = buttons(host);
    for (const name of ["Stop", "Regenerate", "Try again", "Approve all", "Discard", "Undo", "Ask more?", "Edit"]) expect(all).not.toContain(name);
    // Sources still open the note.
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Launch plans"))!.click());
    expect(onCite).toHaveBeenCalledWith(expect.objectContaining({ noteId: "N1" }));
  });

  test("the agent card read-only lists the changes without checkboxes or buttons", () => {
    const { host } = render(<AgentRunCard run={RUN as never} activity={{ busy: null, error: null }} onApprove={vi.fn()} onDiscard={vi.fn()} onUndo={vi.fn()} onOpen={vi.fn()} readOnly />);
    expect(host.textContent).toContain("Proposed, not approved yet.");
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    const done = { ...RUN, status: "done", operations: [{ ...RUN.operations[0], status: "applied" }] };
    const after = render(<AgentRunCard run={done as never} activity={{ busy: null, error: null }} onApprove={vi.fn()} onDiscard={vi.fn()} onUndo={vi.fn()} onOpen={vi.fn()} readOnly />);
    expect(buttons(after.host)).not.toContain("Undo");
  });
});

describe("export all", () => {
  test("a folder per place, safe names, numbered when two match", () => {
    expect(
      Object.keys(
        zipEntries([
          { folder: "Personal", name: "Plans", markdown: "# Plans" },
          { folder: "Personal", name: "plans", markdown: "# plans" },
          { folder: "Studio/One", name: 'What: "now"?', markdown: "# x" },
        ]),
      ),
    ).toEqual(["Personal/Plans.md", "Personal/plans (2).md", "Studio One/What now.md"]);
  });
});

const USAGE = {
  aiIncluded: true,
  blockedReason: null,
  account: "personal",
  place: "Personal",
  plan: "Pro",
  trialing: false,
  canBuy: true,
  allowance: 300,
  used: 42,
  monthlyLeft: 258,
  packCredits: 100,
  held: 0,
  available: 358,
  resetsAt: Date.parse("2026-11-01T00:00:00Z"),
  periodStart: Date.parse("2026-10-01T00:00:00Z"),
  nextPackExpiry: null,
  features: [
    { feature: "chat", label: "Chat", credits: 30 },
    { feature: "agent", label: "Agent", credits: 12 },
    { feature: "writing", label: "Writing", credits: 0 },
  ],
  days: [
    { day: "2026-10-01", credits: 10 },
    { day: "2026-10-02", credits: 0 },
    { day: "2026-10-03", credits: 32 },
  ],
  total: 42,
} as unknown as AiUsageData;

describe("the usage card", () => {
  test("allowance, used, extra and left; when it resets; credits by feature", () => {
    const { host } = render(<UsageSummary usage={USAGE} />);
    const figures = [...host.querySelectorAll("dl > div")].map((d) => [d.querySelector("dt")!.textContent, d.querySelector("dd")!.textContent]);
    expect(figures).toEqual([
      ["Monthly credits", "300"],
      ["Used this period", "42"],
      ["Extra credits", "100"],
      ["Left", "358"],
    ]);
    expect(host.textContent).toContain("Monthly credits reset on November 1.");
    expect(host.querySelector('a[href="/settings/billing"]')!.textContent).toBe("Buy more");
    const features = [...host.querySelectorAll('section[aria-label="Credits by feature this period"] li')].map((li) => li.textContent);
    expect(features).toEqual(["Chat30", "Agent12", "Writing0"]);
  });

  test("a trial says when it ends; no AI here says why", () => {
    expect(render(<UsageSummary usage={{ ...USAGE, trialing: true, canBuy: false } as AiUsageData} />).host.textContent).toContain("Your trial ends on November 1.");
    const off = render(<UsageSummary usage={{ ...USAGE, aiIncluded: false, blockedReason: "This workspace is on Core." } as AiUsageData} />);
    expect(off.host.textContent).toContain("This workspace is on Core.");
    expect(off.host.querySelector("dl")).toBeNull();
  });

  test("the day chart: one bar per day used, a summary for screen readers, a table, and the number on hover", () => {
    const { host } = render(<UsageChart days={USAGE.days} />);
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Credits used per day, Oct 1 to Oct 3: 42 credits in all, most on Oct 3 (32 credits).");
    // Days with no use have no bar.
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    const rows = [...host.querySelectorAll("table tbody tr")].map((r) => r.textContent);
    expect(rows).toEqual(["Oct 110", "Oct 20", "Oct 332"]);
    expect(host.querySelector("table")!.className).toContain("sr-only");
    act(() => svg.querySelector('g[data-day="2026-10-03"]')!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(host.textContent).toContain("Oct 3: 32 credits");
    expect(render(<UsageChart days={[{ day: "2026-10-01", credits: 0 }]} />).host.querySelector("svg")!.getAttribute("aria-label")).toBe("No credits used yet this period.");
  });
});
