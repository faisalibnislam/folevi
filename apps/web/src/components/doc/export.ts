"use client";

import { strToU8, zipSync, type Zippable } from "fflate";
import { blocksToHtml, blocksToMarkdown, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import type { ConvexReactClient } from "convex/react";
import { api } from "@/lib/convex/api";
import { loadKatex } from "@/components/editor/richRender";

/** What an export left out (shown to the person — nothing is dropped silently). */
export interface ExportReport {
  /** Attachments that couldn't be fetched (names), kept as links without a file. */
  missingAssets: string[];
}

function safeName(name: string): string {
  return (name || "Untitled").replace(/[\u0000-\u001F\u007F/\\:*?"<>|]+/g, "-").trim().slice(0, 120) || "Untitled";
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const hourNow = () => Math.floor(Date.now() / 3_600_000) * 3_600_000;

function fileRefs(blocks: WireBlock[]): { id: string; name: string }[] {
  return blocks.flatMap((b) => {
    const p = b.props as { fileId?: unknown; name?: unknown; alt?: unknown };
    return typeof p.fileId === "string" ? [{ id: p.fileId, name: String(p.name || p.alt || (b.type === "image" ? "image" : "file")) }] : [];
  });
}

/** Ids of pages linked from the document (page cards and inline [[links]], including table cells). */
export function linkedDocumentIds(blocks: WireBlock[]): string[] {
  const ids = new Set<string>();
  const scan = (nodes: readonly InlineNode[]) => {
    for (const n of nodes) if (n.type === "pageLink") ids.add(n.documentId);
  };
  for (const b of blocks) {
    scan(b.text);
    const p = b.props as { documentId?: unknown; rows?: unknown };
    if (b.type === "page" && typeof p.documentId === "string") ids.add(p.documentId);
    if (b.type === "table" && Array.isArray(p.rows)) for (const row of p.rows as InlineNode[][][]) for (const cell of row) scan(cell);
  }
  return [...ids];
}

/** Current titles of linked pages and app links to them, so exports never show stale "Untitled" labels. */
async function pageLinks(client: ConvexReactClient, blocks: WireBlock[]) {
  const ids = linkedDocumentIds(blocks);
  const titles = ids.length ? await client.query(api.documents.titles, { documentIds: ids }) : {};
  return {
    resolveDocument: (id: string) => `${window.location.origin}/d/${id}`,
    resolveDocumentTitle: (id: string) => titles[id]?.title || null,
  };
}

async function fetchAssets(client: ConvexReactClient, blocks: WireBlock[]) {
  const refs = fileRefs(blocks);
  const assets = new Map<string, { path: string; bytes: Uint8Array }>();
  const missing: string[] = [];
  if (!refs.length) return { assets, missing };
  const urls = await client.query(api.files.urls, { fileIds: refs.map((r) => r.id), now: hourNow() });
  for (const ref of refs) {
    if (assets.has(ref.id)) continue;
    const info = urls[ref.id];
    if (!info) {
      missing.push(ref.name);
      continue;
    }
    try {
      const res = await fetch(info.url);
      if (!res.ok) throw new Error(String(res.status));
      assets.set(ref.id, { path: `assets/${ref.id}-${safeName(info.filename)}`, bytes: new Uint8Array(await res.arrayBuffer()) });
    } catch {
      missing.push(info.filename || ref.name);
    }
  }
  return { assets, missing };
}

/** Markdown (plus an assets folder, as a ZIP, when the page has attachments). */
export async function exportMarkdown(client: ConvexReactClient, title: string, blocks: WireBlock[]): Promise<ExportReport> {
  const [{ assets, missing }, links] = await Promise.all([fetchAssets(client, blocks), pageLinks(client, blocks)]);
  const md = blocksToMarkdown(blocks, { title: title || "Untitled", resolveFile: (id) => assets.get(id)?.path ?? null, ...links });
  const name = safeName(title);
  if (!assets.size) {
    download(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${name}.md`);
  } else {
    const zip: Zippable = { [`${name}.md`]: strToU8(md) };
    for (const a of assets.values()) zip[a.path] = a.bytes;
    download(new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${name}.zip`);
  }
  return { missingAssets: missing };
}

/**
 * Formulas in HTML/PDF exports become MathML (rendered natively by browsers, no fonts or CSS needed).
 * KaTeX only loads when the page has a formula.
 */
async function mathRenderer(blocks: WireBlock[]): Promise<((latex: string) => string | null) | undefined> {
  if (!blocks.some((b) => b.type === "formula")) return undefined;
  const katex = await loadKatex();
  return (latex) => {
    try {
      return katex.renderToString(latex, { displayMode: true, output: "mathml", throwOnError: false, trust: false, strict: "ignore", maxSize: 40, maxExpand: 500 });
    } catch {
      return null;
    }
  };
}

export async function exportHtml(client: ConvexReactClient, title: string, blocks: WireBlock[]): Promise<ExportReport> {
  const [{ assets, missing }, links, renderMath] = await Promise.all([fetchAssets(client, blocks), pageLinks(client, blocks), mathRenderer(blocks)]);
  const html = blocksToHtml(blocks, { title: title || "Untitled", resolveFile: (id) => assets.get(id)?.path ?? null, renderMath, ...links });
  const name = safeName(title);
  if (!assets.size) {
    download(new Blob([html], { type: "text/html;charset=utf-8" }), `${name}.html`);
  } else {
    const zip: Zippable = { [`${name}.html`]: strToU8(html) };
    for (const a of assets.values()) zip[a.path] = a.bytes;
    download(new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${name}-html.zip`);
  }
  return { missingAssets: missing };
}

/** PDF via the browser's print dialog ("Save as PDF"), using the same clean HTML as the HTML export. */
export async function exportPdf(client: ConvexReactClient, title: string, blocks: WireBlock[]): Promise<ExportReport> {
  const refs = fileRefs(blocks);
  const [urls, links, renderMath] = await Promise.all([
    refs.length ? client.query(api.files.urls, { fileIds: refs.map((r) => r.id), now: hourNow() }) : Promise.resolve({} as Record<string, { url: string }>),
    pageLinks(client, blocks),
    mathRenderer(blocks),
  ]);
  const missing = refs.filter((r) => !urls[r.id]).map((r) => r.name);
  const html = blocksToHtml(blocks, { title: title || "Untitled", resolveFile: (id) => urls[id]?.url ?? null, renderMath, ...links });
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => setTimeout(r, 400));
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 60_000);
  return { missingAssets: missing };
}
