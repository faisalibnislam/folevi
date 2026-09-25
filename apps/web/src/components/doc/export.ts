"use client";

import { strToU8, zipSync, type Zippable } from "fflate";
import { blocksToHtml, blocksToMarkdown, type WireBlock } from "@folevi/editor-schema";
import type { ConvexReactClient } from "convex/react";
import { api } from "@/lib/convex/api";

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

async function fetchAssets(client: ConvexReactClient, blocks: WireBlock[]) {
  const fileIds = blocks.flatMap((b) => (typeof (b.props as { fileId?: unknown }).fileId === "string" ? [(b.props as { fileId: string }).fileId] : []));
  if (!fileIds.length) return new Map<string, { path: string; bytes: Uint8Array }>();
  const urls = await client.query(api.files.urls, { fileIds, now: Math.floor(Date.now() / 3_600_000) * 3_600_000 });
  const out = new Map<string, { path: string; bytes: Uint8Array }>();
  for (const [id, info] of Object.entries(urls)) {
    try {
      const res = await fetch(info.url);
      if (!res.ok) continue;
      out.set(id, { path: `assets/${id}-${safeName(info.filename)}`, bytes: new Uint8Array(await res.arrayBuffer()) });
    } catch {
      /* skip unreachable asset; the export still completes */
    }
  }
  return out;
}

/** Markdown + assets folder, packaged as a ZIP. */
export async function exportMarkdown(client: ConvexReactClient, title: string, blocks: WireBlock[]) {
  const assets = await fetchAssets(client, blocks);
  const md = blocksToMarkdown(blocks, {
    title: title || "Untitled",
    resolveFile: (id) => assets.get(id)?.path ?? null,
    resolveDocument: () => null,
  });
  const name = safeName(title);
  if (!assets.size) {
    download(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${name}.md`);
    return;
  }
  const zip: Zippable = { [`${name}.md`]: strToU8(md) };
  for (const a of assets.values()) zip[a.path] = a.bytes;
  download(new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${name}.zip`);
}

export async function exportHtml(client: ConvexReactClient, title: string, blocks: WireBlock[]) {
  const assets = await fetchAssets(client, blocks);
  const html = blocksToHtml(blocks, { title: title || "Untitled", resolveFile: (id) => assets.get(id)?.path ?? null });
  const name = safeName(title);
  if (!assets.size) {
    download(new Blob([html], { type: "text/html;charset=utf-8" }), `${name}.html`);
    return;
  }
  const zip: Zippable = { [`${name}.html`]: strToU8(html) };
  for (const a of assets.values()) zip[a.path] = a.bytes;
  download(new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${name}-html.zip`);
}

/** PDF via the browser's print dialog ("Save as PDF"), using the same clean HTML as the HTML export. */
export async function exportPdf(client: ConvexReactClient, title: string, blocks: WireBlock[]) {
  const fileIds = blocks.flatMap((b) => (typeof (b.props as { fileId?: unknown }).fileId === "string" ? [(b.props as { fileId: string }).fileId] : []));
  const urls = fileIds.length ? await client.query(api.files.urls, { fileIds, now: Math.floor(Date.now() / 3_600_000) * 3_600_000 }) : {};
  const html = blocksToHtml(blocks, { title: title || "Untitled", resolveFile: (id) => urls[id]?.url ?? null });
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
}
