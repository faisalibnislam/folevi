"use client";

// What shapes hold, and the panels that change it: the shape library (add, drag out, change kind), icons,
// colours (fill, outline, text), images (pick, drop or paste one onto a shape or the canvas; uploaded the
// way every attachment is, so it works in an account and in local mode), notes (a badge opens them) and
// links to Folevi pages (a badge opens the page), plus auto-height and fit-to-text. Every change is one
// undo step. FlowchartView draws `panel`, `overlay` and `status`, spreads `canvasProps` on the canvas, and
// hands `bar` to the shape bar and `menuItems` to the right-click menu.
import { useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { ArrowUpRight, Crop, FileSymlink, Image as ImageIcon, ImageMinus, Maximize2, MoveVertical, Palette, Replace, Shapes, Smile, StickyNote, Unlink } from "lucide-react";
import type { MenuItem } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { useNoteAi } from "@/components/ai/useAi";
import { useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { uploadFileNow } from "@/lib/sync/uploads";
import { useEditorEnvironment } from "../../environment";
import { FLOWCHART_SHAPE_SIZE, type FlowIconName, type FlowIconPlace, type FlowNode, type FlowShape, type Pt, type TextColor } from "../schema";
import { addNode, nodeAt } from "../ops";
import { changeShape, fitToText, freeSpot, imageNodeSize, labelColor, patchNodes, setAutoHeight, setIcon, setImage, setLabelColor, setLink, setNote, setPaint, type Paint } from "../contentOps";
import { useFlowImageUrls } from "../useImageUrls";
import { ShapeLibrary, ShapeThumb } from "../chrome/ShapeLibrary";
import { IconPicker } from "../chrome/IconPicker";
import { ColorPanel, type PaintState } from "../chrome/ColorPanel";
import { NotePanel } from "../chrome/NotePanel";
import { PageLinkPicker } from "../chrome/PageLinkPicker";
import type { FlowController, Interaction } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";

export type ContentPanel = { kind: "shapes"; mode: "add" | "change" } | { kind: "icons" } | { kind: "colors" } | { kind: "link"; id: string } | { kind: "note"; id: string; edit: boolean };

export const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
/** The same limit as other images (convex/lib/images.ts). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const same = <T,>(list: T[]): T | null => (list.length && list.every((x) => x === list[0]) ? list[0]! : null);

async function imageSize(file: File): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const size = { w: bmp.width, h: bmp.height };
    bmp.close();
    return size;
  } catch {
    return { w: 4, h: 3 };
  }
}

export type ShapeContent = ReturnType<typeof useShapeContent>;

export function useShapeContent(ctrl: FlowController, { actions }: { actions: FlowActions }) {
  const { docRef, commit, selRef, setSel, wrapRef, toWorld, viewCenter } = ctrl;
  const [panel, setPanel] = useState<ContentPanel | null>(null);
  const [ghost, setGhost] = useState<{ shape: FlowShape; x: number; y: number; over: boolean } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>({});
  const remote = useFlowImageUrls(ctrl.doc);
  const imageUrls = useMemo(() => ({ ...previews, ...remote }), [previews, remote]);
  const env = useEditorEnvironment();
  const documentId = useNoteAi()?.home?.id;
  const client = useConvex();
  const toast = useToast();
  const { navigate } = useAppRouter();
  const { engine } = useAppState();
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFor = useRef<string[] | null>(null);
  const [iconPlace, setIconPlace] = useState<FlowIconPlace>("left");

  // A panel's shape is gone (undo, someone else deleted it): the panel closes.
  const panelGone = !!panel && "id" in panel && !ctrl.byId.has(panel.id);
  useEffect(() => {
    if (panelGone) setPanel(null);
  }, [panelGone]);
  // This device's copies of uploaded images are let go with the canvas.
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(() => () => Object.values(previewsRef.current).forEach((u) => URL.revokeObjectURL(u)), []);

  const closePanel = (refocus = true) => {
    setPanel(null);
    if (refocus) wrapRef.current?.focus({ preventScroll: true });
  };

  /** One undo step over the selected shapes (or `ids`). */
  const edit = (patch: (n: FlowNode) => FlowNode, ids: readonly string[] = selRef.current.nodes) => {
    if (!ids.length) return;
    const next = patchNodes(docRef.current, ids, patch);
    if (next !== docRef.current) commit(next);
  };

  // ---------------------------------------------------------------- images

  /** Uploads an image into this note (its storage, its access) and returns the file id. */
  const upload = async (file: File): Promise<string | null> => {
    if (!IMAGE_TYPES.test(file.type)) {
      toast.show("Choose a PNG, JPEG, WebP or GIF image.", { tone: "error" });
      return null;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.show("Images can be up to 20 MB.", { tone: "error" });
      return null;
    }
    if (env.demo) {
      env.unavailable("Images");
      return null;
    }
    if (!documentId) {
      toast.show("This note isn't ready for images yet. Try again in a moment.", { tone: "error" });
      return null;
    }
    setUploading((u) => u + 1);
    try {
      // A note made a moment ago has to reach the server before a file can be stored in it.
      await engine?.whenDocumentOnServer(documentId, 60_000);
      const fileId = await uploadFileNow(client, { documentId, blob: file, filename: file.name || "image.png", mimeType: file.type, kind: "image" });
      // Shown from this device's copy until the file's own address arrives.
      const url = URL.createObjectURL(file);
      setPreviews((p) => ({ ...p, [fileId]: url }));
      return fileId;
    } catch (e) {
      toast.show(e instanceof Error && e.message ? e.message : "The image couldn't be uploaded.", { tone: "error" });
      return null;
    } finally {
      setUploading((u) => u - 1);
    }
  };

  /** Puts an image into shapes `ids`, or into a new shape at `at` (sized to the picture) without any. */
  const putImage = async (file: File, ids: readonly string[] | null, at?: Pt) => {
    const fileId = await upload(file);
    if (!fileId) return;
    const fc = docRef.current;
    const targets = (ids ?? []).filter((id) => fc.nodes.some((n) => n.id === id));
    if (targets.length) {
      commit(patchNodes(fc, targets, (n) => setImage(n, { fileId, fit: n.image?.fit })));
      return;
    }
    const dims = await imageSize(file);
    const size = imageNodeSize(dims.w, dims.h);
    // Dropped where it was let go; pasted or picked, the nearest free spot to the middle of the view.
    const p = at ?? freeSpot(docRef.current, viewCenter(), size.w, size.h);
    const def = FLOWCHART_SHAPE_SIZE.rectangle;
    // addNode centres a default-sized shape: shift so the picture's own size is centred on the point.
    const res = addNode(docRef.current, "rectangle", { x: p.x - size.w / 2 + def.w / 2, y: p.y - size.h / 2 + def.h / 2 }, { ...size, image: { fileId } });
    if (!res) {
      toast.show("The flowchart is full.", { tone: "error" });
      return;
    }
    commit(res.doc);
    setSel({ nodes: [res.id], edges: [] });
  };

  const pickImage = (ids: readonly string[]) => {
    pickFor.current = [...ids];
    fileInput.current?.click();
  };

  /** An image pasted or dropped while writing in a shape. */
  const onImageWhileWriting = (nodeId: string, file: File) => void putImage(file, [nodeId]);

  const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => IMAGE_TYPES.test(f.type));

  /** Spread on the canvas element: dropping and pasting images. */
  const canvasProps = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const n = nodeAt(docRef.current, toWorld(e.clientX, e.clientY));
      if ((n?.id ?? null) !== dropOn) setDropOn(n?.id ?? null);
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      setDropOn(null);
      const files = imageFiles(e.dataTransfer.files);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const at = toWorld(e.clientX, e.clientY);
      const on = nodeAt(docRef.current, at);
      files.slice(0, 5).forEach((f, i) => void putImage(f, i === 0 && on ? [on.id] : null, { x: at.x + i * 32, y: at.y + i * 32 }));
    },
    onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable || ctrl.editingRef.current) return;
      const files = imageFiles(e.clipboardData.files);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const s = selRef.current;
      files.slice(0, 5).forEach((f, i) => void putImage(f, i === 0 && s.nodes.length && !s.edges.length ? s.nodes : null));
    },
  };

  // ---------------------------------------------------------------- badges

  const openPage = (id: string) => {
    if (env.demo) return env.unavailable("Links to pages");
    navigate(`/d/${id}`);
  };

  /** Pressing a note badge opens the note; a link badge opens the page. */
  const interaction: Interaction = {
    handles: "[data-fc-badge]",
    press: ({ target }) => {
      const b = target.closest("[data-fc-badge]");
      if (!b) return null;
      const id = b.getAttribute("data-node")!;
      const n = docRef.current.nodes.find((x) => x.id === id);
      if (!n) return "handled";
      setSel({ nodes: [id], edges: [] });
      if (b.getAttribute("data-fc-badge") === "note") setPanel({ kind: "note", id, edit: false });
      else if (n.link) openPage(n.link.documentId);
      return "handled";
    },
    doubleClick: ({ target }) => !!target.closest("[data-fc-badge]"),
  };

  // ---------------------------------------------------------------- what the bar and the menu offer

  const sel = ctrl.selNodes;
  const one = sel.length === 1 ? sel[0]! : null;
  const paintState: PaintState = {
    color: same(sel.map((n) => n.color)),
    fill: same(sel.map((n) => n.fill ?? "")) || null,
    stroke: same(sel.map((n) => n.stroke ?? "")) || null,
    strokeWidth: same(sel.map((n) => n.strokeWidth ?? 1.5)),
    strokeStyle: same(sel.map((n) => n.strokeStyle ?? "solid")),
    textColor: (() => {
      const c = sel.map((n) => labelColor(n));
      return c.length && c.every((x) => x === c[0]) ? c[0]! : "mixed";
    })(),
  };

  const open = (p: ContentPanel) => setPanel((cur) => (cur && cur.kind === p.kind && (!("id" in cur) || ("id" in p && cur.id === p.id)) ? null : p));
  const anyAuto = sel.some((n) => n.autoHeight);

  /** The shape bar's extra tools (FlowchartChrome.tsx NodeBar), for the selected shapes. */
  const bar = {
    onShapeLibrary: () => open({ kind: "shapes", mode: "change" }),
    libraryOpen: panel?.kind === "shapes" && panel.mode === "change",
    colorsOpen: panel?.kind === "colors",
    onColors: () => open({ kind: "colors" }),
    iconOpen: panel?.kind === "icons",
    onIcon: () => open({ kind: "icons" }),
    onImage: () => pickImage(selRef.current.nodes),
    hasImage: sel.some((n) => n.image),
    onRemoveImage: () => edit((n) => setImage(n, null)),
    note: one ? { has: !!one.note, open: panel?.kind === "note" && panel.id === one.id, onOpen: () => open({ kind: "note", id: one.id, edit: true }) } : null,
    link: one ? { has: !!one.link, open: panel?.kind === "link" && panel.id === one.id, onOpen: () => open({ kind: "link", id: one.id }), onFollow: one.link ? () => openPage(one.link!.documentId) : null } : null,
    autoHeight: anyAuto,
    onAutoHeight: () => edit((n) => setAutoHeight(n, !anyAuto)),
    onFit: () => edit(fitToText),
  };

  /** Right-click menu entries for shape `id` (with the current selection). */
  const menuItems = (id: string): (MenuItem | "separator")[] => {
    const n = docRef.current.nodes.find((x) => x.id === id);
    if (!n) return [];
    const ids = selRef.current.nodes.includes(id) ? selRef.current.nodes : [id];
    const items: (MenuItem | "separator")[] = [
      { label: "Change shape…", icon: <Shapes size={14} />, onSelect: () => setPanel({ kind: "shapes", mode: "change" }) },
      { label: n.icon ? "Change icon…" : "Add icon…", icon: <Smile size={14} />, onSelect: () => setPanel({ kind: "icons" }) },
      { label: "Colours…", icon: <Palette size={14} />, onSelect: () => setPanel({ kind: "colors" }) },
      "separator",
      { label: n.image ? "Replace image…" : "Add image…", icon: n.image ? <Replace size={14} /> : <ImageIcon size={14} />, onSelect: () => pickImage(ids) },
    ];
    if (n.image) {
      items.push(
        { label: n.image.fit === "contain" ? "Fill the space with the image" : "Show the whole image", icon: <Crop size={14} />, onSelect: () => edit((x) => (x.image ? setImage(x, { fileId: x.image.fileId, fit: n.image?.fit === "contain" ? "cover" : "contain" }) : x), ids) },
        { label: "Remove image", icon: <ImageMinus size={14} />, onSelect: () => edit((x) => setImage(x, null), ids) },
      );
    }
    items.push(
      "separator",
      { label: n.note ? "Edit note…" : "Add note…", icon: <StickyNote size={14} />, onSelect: () => setPanel({ kind: "note", id, edit: true }) },
      { label: n.link ? "Change page link…" : "Link to a page…", icon: <FileSymlink size={14} />, onSelect: () => setPanel({ kind: "link", id }) },
    );
    if (n.link) {
      const target = n.link.documentId;
      items.push({ label: "Open linked page", icon: <ArrowUpRight size={14} />, onSelect: () => openPage(target) }, { label: "Remove page link", icon: <Unlink size={14} />, onSelect: () => edit((x) => setLink(x, null), [id]) });
    }
    const auto = ids.some((x) => docRef.current.nodes.find((m) => m.id === x)?.autoHeight);
    items.push(
      "separator",
      { label: "Grow with text", icon: <MoveVertical size={14} />, checked: auto, onSelect: () => edit((x) => setAutoHeight(x, !auto), ids) },
      { label: "Fit to text", icon: <Maximize2 size={14} />, onSelect: () => edit(fitToText, ids) },
    );
    return items;
  };

  // ---------------------------------------------------------------- panels

  const onLibraryDrag = (shape: FlowShape, e: React.PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const overPanel = !!(document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(".fc-panel");
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && !overPanel;
    if (e.type === "pointerup") {
      setGhost(null);
      if (over) actions.add(shape, toWorld(e.clientX, e.clientY), false);
      return;
    }
    setGhost({ shape, x: e.clientX - r.left, y: e.clientY - r.top, over });
  };

  let element: React.ReactNode = null;
  if (panel?.kind === "shapes") {
    element = (
      <ShapeLibrary
        mode={panel.mode}
        current={same(sel.map((n) => n.shape))}
        onPick={(s) => {
          if (panel.mode === "change") edit((n) => changeShape(n, s));
          else actions.add(s, viewCenter(), false);
        }}
        onDragOut={panel.mode === "add" ? onLibraryDrag : undefined}
        onClose={() => closePanel()}
      />
    );
  } else if (panel?.kind === "icons") {
    const icons = sel.map((n) => n.icon?.name ?? null);
    const place = same(sel.map((n) => n.icon?.place ?? "left")) ?? iconPlace;
    element = (
      <IconPicker
        current={same(icons)}
        place={sel.some((n) => n.icon) ? place : iconPlace}
        onPick={(name: FlowIconName) => edit((n) => setIcon(n, { name, place: n.icon?.place ?? iconPlace }))}
        onPlace={(p) => {
          setIconPlace(p);
          edit((n) => (n.icon ? setIcon(n, { name: n.icon.name, place: p }) : n));
        }}
        onRemove={sel.some((n) => n.icon) ? () => edit((n) => setIcon(n, null)) : null}
        onClose={() => closePanel()}
      />
    );
  } else if (panel?.kind === "colors") {
    element = <ColorPanel state={paintState} onPaint={(p: Paint) => edit((n) => setPaint(n, p))} onTextColor={(c: TextColor | null) => edit((n) => setLabelColor(n, c))} onClose={() => closePanel()} />;
  } else if (panel?.kind === "link") {
    const n = ctrl.byId.get(panel.id);
    element = n ? (
      <PageLinkPicker
        current={n.link ?? null}
        documentId={documentId}
        onPick={(page) => {
          if (env.demo) return env.unavailable("Links to pages");
          edit((x) => setLink(x, page), [panel.id]);
          closePanel();
        }}
        onRemove={() => {
          edit((x) => setLink(x, null), [panel.id]);
          closePanel();
        }}
        onOpen={openPage}
        onClose={() => closePanel()}
      />
    ) : null;
  } else if (panel?.kind === "note") {
    const n = ctrl.byId.get(panel.id);
    if (n) {
      // Beside the shape's top right corner (where its badge is), kept inside the canvas.
      const k = ctrl.view.k;
      const w = Math.min(300, ctrl.width - 20);
      const left = Math.max(10, Math.min(ctrl.width - w - 10, (n.x + n.w) * k + ctrl.view.x + 8));
      const top = Math.max(54, Math.min(ctrl.height - 200, n.y * k + ctrl.view.y));
      element = <NotePanel key={panel.id} note={n.note ?? ""} editing={panel.edit} editable style={{ left, top, width: w }} onSave={(note) => edit((x) => setNote(x, note), [panel.id])} onClose={() => closePanel()} />;
    }
  }


  /** World-space highlights: the shape an image will drop onto. */
  const dropNode = dropOn ? ctrl.byId.get(dropOn) : undefined;
  const overlay = dropNode ? <rect className="fc-drop-target" x={dropNode.x - 4} y={dropNode.y - 4} width={dropNode.w + 8} height={dropNode.h + 8} rx={10} /> : null;

  /** HTML over the canvas: the shape being dragged out of the library, uploads in progress, the file picker. */
  const status = (
    <>
      {ghost ? (
        <div className="fc-drag-ghost" data-over={ghost.over || undefined} style={{ left: ghost.x, top: ghost.y }} aria-hidden>
          <ShapeThumb shape={ghost.shape} width={64} height={48} />
        </div>
      ) : null}
      {uploading ? (
        <p className="fc-status" role="status">
          Uploading image…
        </p>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void putImage(f, pickFor.current);
        }}
      />
    </>
  );

  return {
    interaction,
    /** The open panel (HTML, inside the canvas). */
    panel: element,
    panelOpen: panel,
    setPanel,
    openLibrary: () => open({ kind: "shapes", mode: "add" }),
    libraryOpen: panel?.kind === "shapes" && panel.mode === "add",
    overlay,
    status,
    canvasProps,
    bar,
    menuItems,
    imageUrls,
    onImageWhileWriting,
  };
}
