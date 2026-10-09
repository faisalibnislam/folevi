"use client";
// Folevi's own right-click menu wherever a part of the app doesn't have one (the editor, note cards and
// tabs have their own; Shift+right-click still opens the browser's). It fits what was clicked:
// - a row or card with a "…" menu (a folder, a tag): that menu;
// - a text field: cut, copy, paste and select all;
// - a link: open it, here or in a new browser tab, or copy its address;
// - selected text: copy it, or ask AI about it;
// - anywhere else: a new note, search, Ask AI, and back / forward / reload.
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ClipboardPaste, Copy, ExternalLink, FilePlus2, Link2, RotateCw, Scissors, Search, TextSelect } from "lucide-react";
import { ContextMenu, type MenuItem } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAiEnabled } from "@/components/ai/useAi";
import { useAppRouter } from "@/lib/app/router";
import { modKey } from "@/lib/hooks/useEngine";
import { installTouchContextMenu } from "@/lib/touchContextMenu";
import { useShell } from "./Shell";
import { useCreateDocument } from "./useCreateDocument";

type Field = HTMLInputElement | HTMLTextAreaElement;
const TEXT_INPUTS = /^(text|search|email|url|tel|password|number)$/;

function textField(el: Element | null): Field | null {
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && TEXT_INPUTS.test(el.type)) return el;
  return null;
}

export function AppContextMenu() {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: (MenuItem | "separator")[]; label: string; host?: HTMLElement } | null>(null);
  const { openPalette, openAsk } = useShell();
  const { navigate } = useAppRouter();
  const createDocument = useCreateDocument();
  const aiOn = useAiEnabled();
  const toast = useToast();

  // Press and hold on iPhone and iPad opens these menus too (Safari there sends no right-click).
  useEffect(() => installTouchContextMenu(), []);

  useEffect(() => {
    const copyText = (text: string, done: string) =>
      navigator.clipboard.writeText(text).then(
        () => toast.show(done),
        () => toast.show("Couldn’t copy. Your browser blocked clipboard access.", { tone: "error" }),
      );
    const onContext = (e: MouseEvent) => {
      // Handled already (the editor, a card, a tab), or Shift for the browser's own menu.
      if (e.defaultPrevented || e.shiftKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      // Inside a dialog or menu of the browser's own kind (a file picker, a video), leave it.
      if (target.closest("video, audio, iframe, [data-native-menu]")) return;
      const at = { x: e.clientX, y: e.clientY };
      const mod = modKey();
      // In an open dialog the menu goes inside it (outside, a modal dialog makes it unusable).
      const host = target.closest<HTMLElement>("dialog[open]") ?? undefined;

      // A row or card with its own "…" menu: open that.
      const row = target.closest<HTMLElement>("[data-ctx-host]");
      const trigger = row?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
      // Text selected inside the row is for copying, so it gets the text menu below.
      const sel = window.getSelection();
      const picked = !!sel && !sel.isCollapsed && !!row && row.contains(sel.anchorNode);
      if (trigger && !textField(target) && !picked) {
        e.preventDefault();
        trigger.click();
        return;
      }

      // A text field.
      const field = textField(target);
      if (field) {
        e.preventDefault();
        const selected = (field.selectionEnd ?? 0) > (field.selectionStart ?? 0);
        const editable = !field.readOnly && !field.disabled;
        setMenu({
          at,
          host,
          label: "Text options",
          items: [
            ...(editable ? [{ label: "Cut", icon: <Scissors size={14} />, shortcut: "⌘X", disabled: !selected || field.type === "password", onSelect: () => (field.focus(), document.execCommand("cut")) }] : []),
            { label: "Copy", icon: <Copy size={14} />, shortcut: "⌘C", disabled: !selected || field.type === "password", onSelect: () => (field.focus(), document.execCommand("copy")) },
            ...(editable
              ? [
                  {
                    label: "Paste",
                    icon: <ClipboardPaste size={14} />,
                    shortcut: "⌘V",
                    onSelect: () =>
                      void navigator.clipboard.readText().then(
                        (text) => {
                          field.focus();
                          document.execCommand("insertText", false, text);
                        },
                        () => toast.show(`Your browser didn’t allow pasting from here. Press ${mod}V instead.`, { tone: "error" }),
                      ),
                  },
                ]
              : []),
            "separator",
            { label: "Select all", icon: <TextSelect size={14} />, shortcut: "⌘A", onSelect: () => (field.focus(), field.select()) },
          ],
        });
        return;
      }
      // Other editable text (not the editor, which has its own menu): leave the browser's.
      if (target.closest('[contenteditable="true"]')) return;

      const items: (MenuItem | "separator")[] = [];
      // A link.
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (link) {
        const href = link.getAttribute("href")!;
        const url = new URL(href, location.href);
        const inApp = url.origin === location.origin;
        items.push(
          { label: "Open", icon: <ArrowRight size={14} />, onSelect: () => (inApp ? navigate(`${url.pathname}${url.search}${url.hash}`) : window.open(url.href, "_blank", "noopener,noreferrer")) },
          { label: "Open in new browser tab", icon: <ExternalLink size={14} />, onSelect: () => window.open(url.href, "_blank", "noopener,noreferrer") },
          { label: "Copy link", icon: <Link2 size={14} />, onSelect: () => void copyText(url.href, "Link copied") },
          "separator",
        );
      }
      // Selected text.
      const selection = window.getSelection()?.toString().trim() ?? "";
      if (selection) {
        items.push({ label: "Copy", icon: <Copy size={14} />, shortcut: "⌘C", onSelect: () => void copyText(selection, "Copied") });
        if (aiOn) items.push({ label: "Ask Foli about this", icon: <AiIcon size={14} />, onSelect: () => openAsk(`About this: “${selection.slice(0, 500)}”`) });
        items.push("separator");
      }
      // Anywhere.
      items.push(
        { label: "New note", icon: <FilePlus2 size={14} />, shortcut: "⌘⌥N", onSelect: () => void createDocument({}) },
        { label: "Search or jump to…", icon: <Search size={14} />, shortcut: "⌘K", onSelect: () => openPalette() },
        ...(aiOn ? [{ label: "Ask Foli", icon: <AiIcon size={14} />, shortcut: "⌘J", onSelect: () => openAsk() }] : []),
        "separator",
        { label: "Back", icon: <ArrowLeft size={14} />, onSelect: () => history.back() },
        { label: "Forward", icon: <ArrowRight size={14} />, onSelect: () => history.forward() },
        { label: "Reload", icon: <RotateCw size={14} />, onSelect: () => location.reload() },
      );
      e.preventDefault();
      setMenu({ at, host, label: "Folevi", items });
    };
    document.addEventListener("contextmenu", onContext);
    return () => document.removeEventListener("contextmenu", onContext);
  }, [openPalette, openAsk, navigate, createDocument, aiOn, toast]);

  return menu ? <ContextMenu at={menu.at} label={menu.label} items={menu.items} host={menu.host} onClose={() => setMenu(null)} /> : null;
}
