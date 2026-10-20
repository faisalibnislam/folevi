"use client";
// A PDF's words, read on this device with pdf.js (loaded only when a PDF needs reading, with its own worker),
// for search (lib/fileText/indexer.ts). Nothing runs on Folevi's servers. The legacy build, so the iPhone and
// iPad app's web view (iOS 17) reads them too.
import { joinPdfPages, MAX_PDF_BYTES, MAX_PDF_PAGES } from "@folevi/editor-schema";

type PdfJs = typeof import("pdfjs-dist");

let loading: Promise<PdfJs> | null = null;

/** pdf.js, loaded once, with a worker of its own (the page's thread stays free). */
function pdfjs(): Promise<PdfJs> {
  loading ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((lib) => {
    const pdf = lib as unknown as PdfJs;
    if (typeof Worker !== "undefined" && !pdf.GlobalWorkerOptions.workerPort) {
      pdf.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    }
    return pdf;
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** One page's text items as lines (pdf.js marks where a line ends). */
function pageText(items: readonly unknown[]): string {
  let out = "";
  for (const it of items) {
    if (!it || typeof it !== "object" || !("str" in it)) continue;
    const item = it as { str: string; hasEOL?: boolean };
    out += item.str;
    out += item.hasEOL ? "\n" : item.str && !item.str.endsWith(" ") ? " " : "";
  }
  return out;
}

/**
 * The text of a PDF, page by page, with where each page starts (for "in PDF, page 3"). Capped: files over
 * MAX_PDF_BYTES aren't read, and only the first MAX_PDF_PAGES pages are. A scanned PDF (pictures of pages)
 * has no text: it comes back empty.
 */
export async function readPdfText(bytes: ArrayBuffer): Promise<{ text: string; pageStarts: number[] }> {
  if (bytes.byteLength > MAX_PDF_BYTES) return { text: "", pageStarts: [] };
  const pdf = await pdfjs();
  const task = pdf.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, stopAtErrors: false });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    const count = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(pageText(content.items));
      page.cleanup();
    }
    return joinPdfPages(pages);
  } finally {
    await task.destroy();
  }
}
