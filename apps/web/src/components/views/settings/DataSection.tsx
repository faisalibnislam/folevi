"use client";

import { useAction, useMutation } from "convex/react";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";

export function DataSection() {
  const { workspace } = useAppState();
  const importText = useMutation(api.imports.importText);
  const exportWorkspace = useAction(api.exports.exportWorkspace);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<{ name: string; id?: string; warnings: { line: number; message: string }[]; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Card title="Import" description="Markdown (.md) and plain text (.txt). Headings, lists, checklists, links, code, quotes, tables and front matter are kept. Anything we can't convert is kept as text and listed below.">
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            setBusy(true);
            const out: typeof results = [];
            for (const f of files.slice(0, 50)) {
              try {
                const content = await f.text();
                const r = await importText({ workspaceId: workspace.id, filename: f.name, content, format: /\.txt$/i.test(f.name) ? "text" : "markdown" });
                out.push({ name: f.name, id: r.document.id, warnings: r.warnings });
              } catch (err) {
                out.push({ name: f.name, warnings: [], error: errorMessage(err) });
              }
            }
            setResults(out);
            setBusy(false);
            toast.show(`Imported ${out.filter((r) => r.id).length} of ${out.length} file(s)`);
          }}
        />
        <Button onClick={() => input.current?.click()} disabled={busy}>
          <Upload size={14} aria-hidden /> {busy ? "Importing…" : "Choose files…"}
        </Button>
        {results.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {results.map((r) => (
              <li key={r.name} className="rounded-[11px] border border-line p-3">
                <p className="font-medium">
                  {r.id ? <AppLink href={`/d/${r.id}`} className="hover:underline">{r.name}</AppLink> : r.name}
                  {r.error ? <span className="ml-2 text-danger">— {r.error}</span> : null}
                </p>
                {r.warnings.length ? (
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                    {r.warnings.map((w, i) => (
                      <li key={i}>
                        Line {w.line}: {w.message}
                      </li>
                    ))}
                  </ul>
                ) : r.id ? (
                  <p className="text-xs text-muted">Imported without changes.</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card title="Export workspace" description="A ZIP with every document as Markdown, all attachments in an assets folder, and a manifest.json describing folders, documents and files. Single pages can be exported from their ••• menu as Markdown, HTML or PDF.">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await exportWorkspace({ workspaceId: workspace.id });
              const a = document.createElement("a");
              a.href = r.url;
              a.download = r.filename;
              a.click();
              toast.show(`Exported ${r.documents} documents and ${r.assets} attachments`, { tone: "success" });
            } catch (e) {
              toast.show(errorMessage(e), { tone: "error" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Preparing…" : "Export workspace (.zip)"}
        </Button>
      </Card>
    </>
  );
}
