"use client";

// The shape bar's tools for what a shape holds (interactions/content.tsx): colours, icon, image, note,
// page link, and a menu for the text's size (grow with text, fit to text). On a narrow canvas (a phone)
// all but Colours fold into one menu so the bar fits.
import { ArrowUpRight, FileSymlink, ImagePlus, Maximize2, MoreHorizontal, MoveVertical, Palette, Replace, Shapes, Smile, StickyNote, Trash2, Type } from "lucide-react";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import type { ShapeContent } from "../interactions/content";

export function ContentTools({ bar, compact }: { bar: ShapeContent["bar"]; compact: boolean }) {
  const textItems: MenuEntry[] = [
    { label: "Grow with text", description: "The shape's height follows its text", icon: <MoveVertical size={14} />, checked: bar.autoHeight, onSelect: bar.onAutoHeight },
    { label: "Fit to text", description: "Size the shape to its text once", icon: <Maximize2 size={14} />, onSelect: bar.onFit },
  ];
  const imageItems: MenuEntry[] = bar.hasImage
    ? [
        { label: "Replace image…", icon: <Replace size={14} />, onSelect: bar.onImage },
        { label: "Remove image", icon: <Trash2 size={14} />, onSelect: bar.onRemoveImage },
      ]
    : [{ label: "Add image…", icon: <ImagePlus size={14} />, onSelect: bar.onImage }];

  if (compact) {
    const more: MenuEntry[] = [
      { label: "Icon…", icon: <Smile size={14} />, onSelect: bar.onIcon },
      ...imageItems,
      ...(bar.note ? [{ label: bar.note.has ? "Edit note…" : "Add note…", icon: <StickyNote size={14} />, onSelect: bar.note.onOpen }] : []),
      ...(bar.link ? [{ label: bar.link.has ? "Change page link…" : "Link to a page…", icon: <FileSymlink size={14} />, onSelect: bar.link.onOpen }] : []),
      ...(bar.link?.onFollow ? [{ label: "Open linked page", icon: <ArrowUpRight size={14} />, onSelect: bar.link.onFollow }] : []),
      "separator",
      ...textItems,
    ];
    return (
      <span role="group" aria-label="Content" className="fc-group">
        <button type="button" className="fc-btn" aria-label="Colours" aria-expanded={bar.colorsOpen} title="Fill, outline and text colours" onClick={bar.onColors}>
          <Palette size={15} aria-hidden />
        </button>
        <MenuButton label="More for this shape" align="end" triggerClassName="fc-btn" trigger={<MoreHorizontal size={15} aria-hidden />} items={more} />
      </span>
    );
  }

  return (
    <span role="group" aria-label="Content" className="fc-group">
      <button type="button" className="fc-btn" aria-label="Colours" aria-expanded={bar.colorsOpen} title="Fill, outline and text colours" onClick={bar.onColors}>
        <Palette size={15} aria-hidden />
      </button>
      <button type="button" className="fc-btn" aria-label="Icon" aria-expanded={bar.iconOpen} title="Add an icon" onClick={bar.onIcon}>
        <Smile size={15} aria-hidden />
      </button>
      {bar.hasImage ? (
        <MenuButton label="Image" align="start" triggerClassName="fc-btn" trigger={<ImagePlus size={15} aria-hidden />} items={imageItems} />
      ) : (
        <button type="button" className="fc-btn" aria-label="Add image" title="Add an image (or drop or paste one onto the shape)" onClick={bar.onImage}>
          <ImagePlus size={15} aria-hidden />
        </button>
      )}
      {bar.note ? (
        <button type="button" className="fc-btn" aria-label={bar.note.has ? "Edit note" : "Add note"} aria-expanded={bar.note.open} data-has={bar.note.has || undefined} title={bar.note.has ? "Edit the note" : "Add a longer note"} onClick={bar.note.onOpen}>
          <StickyNote size={15} aria-hidden />
        </button>
      ) : null}
      {bar.link ? (
        bar.link.has && bar.link.onFollow ? (
          <MenuButton
            label="Page link"
            align="start"
            triggerClassName="fc-btn"
            trigger={<FileSymlink size={15} aria-hidden />}
            items={[
              { label: "Open linked page", icon: <ArrowUpRight size={14} />, onSelect: bar.link.onFollow },
              { label: "Change page link…", icon: <FileSymlink size={14} />, onSelect: bar.link.onOpen },
            ]}
          />
        ) : (
          <button type="button" className="fc-btn" aria-label="Link to a page" aria-expanded={bar.link.open} title="Link to a Folevi page" onClick={bar.link.onOpen}>
            <FileSymlink size={15} aria-hidden />
          </button>
        )
      ) : null}
      <MenuButton label="Text size" align="start" triggerClassName="fc-btn" trigger={<Type size={15} aria-hidden />} items={textItems} />
    </span>
  );
}

/** The main toolbar's way into the whole shape library (after the quick shapes). */
export function LibraryButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="fc-btn" aria-label="All shapes" aria-expanded={open} title="All shapes: search the library" onClick={onOpen}>
      <Shapes size={15} aria-hidden />
    </button>
  );
}
