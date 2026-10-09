"use client";

import { useState, type ReactNode } from "react";
import { useConvex } from "convex/react";
import { FileCode, FileText, Loader2, Paperclip, Printer } from "lucide-react";
import type { WireBlock } from "@folevi/editor-schema";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { useRadioGroup } from "@/lib/a11y/radioGroup";
import { exportHtml, exportMarkdown, exportPdf, type ExportReport } from "./export";

// Export a note: one dialog (like Share) instead of three menu items. Pick a format, see what happens to
// the note's attachments, then export. The last format picked is remembered on this device.

type Format = "markdown" | "html" | "pdf";

const FORMATS: { id: Format; label: string; ext: string; desc: string; icon: ReactNode; run: typeof exportMarkdown }[] = [
  { id: "markdown", label: "Markdown", ext: ".md", desc: "Plain text with formatting. Opens in any notes app or editor.", icon: <FileText size={18} />, run: exportMarkdown },
  { id: "html", label: "Web page", ext: ".html", desc: "Looks like the note, opens in any browser.", icon: <FileCode size={18} />, run: exportHtml },
  { id: "pdf", label: "PDF", ext: ".pdf", desc: "For printing or sending. Uses your browser's print window.", icon: <Printer size={18} />, run: exportPdf },
];

const LAST_KEY = "folevi:export-format";

function lastFormat(): Format {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return v === "html" || v === "pdf" ? v : "markdown";
  } catch {
    return "markdown";
  }
}

/** What happens to the note's images and files in this format. */
function attachmentNote(format: Format, files: number): string {
  const what = files === 1 ? "The attachment" : `The ${files} attachments`;
  if (format === "pdf") return `${what} ${files === 1 ? "is" : "are"} printed in place (images show, files are listed by name).`;
  return `${what} ${files === 1 ? "goes" : "go"} into a ZIP with the ${format === "html" ? "page" : "Markdown file"}, linked from it.`;
}

export function ExportDialog({ open, onClose, title, blocks }: { open: boolean; onClose: () => void; title: string; blocks: () => WireBlock[] }) {
  const client = useConvex();
  const toast = useToast();
  const group = useRadioGroup();
  const [format, setFormat] = useState<Format>(lastFormat);
  const [busy, setBusy] = useState(false);
  const files = open ? blocks().filter((b) => typeof (b.props as { fileId?: unknown }).fileId === "string").length : 0;
  const chosen = FORMATS.find((f) => f.id === format)!;

  const pick = (f: Format) => {
    setFormat(f);
    try {
      localStorage.setItem(LAST_KEY, f);
    } catch {
      // Remembering is a convenience; private windows may refuse it.
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const r: ExportReport = await chosen.run(client, title, blocks());
      onClose();
      const n = r.missingAssets.length;
      if (!n) toast.show(format === "pdf" ? "Ready to print. Choose Save as PDF in the print window." : `${chosen.label} export ready`);
      else
        toast.show(
          `${chosen.label} export ready, but ${n === 1 ? `“${r.missingAssets[0]}” couldn’t be included` : `${n} attachments couldn’t be included`} (not available or not uploaded yet).`,
          { tone: "error", duration: 10_000 },
        );
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={`Export “${title || "Untitled"}”`}
      description="Download a copy of this note. The note itself doesn't change."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy} aria-busy={busy}>
            {busy ? (
              <>
                <Loader2 size={15} className="mr-1.5 animate-spin motion-reduce:animate-none" aria-hidden /> Preparing…
              </>
            ) : format === "pdf" ? (
              "Print to PDF"
            ) : (
              `Export ${chosen.label}`
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-1 text-sm">
        <div role="radiogroup" aria-label="Format" ref={group.ref} onKeyDown={group.onKeyDown} className="grid gap-2 sm:grid-cols-3">
          {FORMATS.map((f) => {
            const on = f.id === format;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(f.id)}
                className={`flex flex-col items-start gap-2.5 rounded-[10px] border p-3 text-left transition-colors ${on ? "border-accent bg-accent-soft" : "border-line hover:bg-[var(--glass-hover)]"}`}
              >
                <span className={`grid h-9 w-9 place-items-center rounded-[8px] ${on ? "bg-canvas text-heading" : "bg-[var(--glass-hover)] text-muted"}`} aria-hidden>
                  {f.icon}
                </span>
                <span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-medium text-heading">{f.label}</span>
                    <span className="text-xs text-faint">{f.ext}</span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{f.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        {files ? (
          <p className="flex items-start gap-2 rounded-[8px] bg-[var(--glass-hover)] px-3 py-2.5 text-xs text-muted">
            <Paperclip size={14} className="mt-px flex-none" aria-hidden />
            <span>{attachmentNote(format, files)}</span>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
