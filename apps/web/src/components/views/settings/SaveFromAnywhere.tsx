"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { bookmarkletHref } from "@/lib/share/payload";
import { Card } from "./Card";

/**
 * Settings > Import & export: the Save to Folevi bookmarklet (lib/share/payload.ts), and where sharing from
 * a phone comes in (the installed app's share target, /share).
 */
export function SaveFromAnywhereCard() {
  const toast = useToast();
  const link = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState("");
  // React refuses javascript: addresses in href, so the bookmarklet is put on the link directly.
  useEffect(() => {
    const href = bookmarkletHref(window.location.origin);
    setCode(href);
    link.current?.setAttribute("href", href);
  }, []);

  return (
    <Card
      title="Save from anywhere"
      description="Drag the button below to your browser’s bookmarks bar. On any page, click it to save the page’s title, its address and any text you selected to your Inbox. It reads nothing else on the page."
    >
      <div className="flex flex-wrap items-center gap-2">
        <a
          ref={link}
          draggable
          data-testid="bookmarklet"
          onClick={(e) => {
            e.preventDefault();
            toast.show("Drag it to your bookmarks bar, then click it on the page you want to save.");
          }}
          className="ui-btn ui-btn-primary h-9 cursor-grab px-4 text-sm"
        >
          <BookmarkPlus size={14} aria-hidden /> Save to Folevi
        </a>
        <Button disabled={!code} onClick={() => void navigator.clipboard.writeText(code).then(() => toast.show("Bookmarklet copied. Paste it as the address of a new bookmark."))}>
          <Copy size={13} aria-hidden /> Copy as text
        </Button>
      </div>
      <p className="mt-4 text-[13px] text-muted">On Android, install Folevi from your browser’s menu (Add to home screen), then pick Folevi in any app’s Share menu. Links, text, images and PDFs go to your Inbox.</p>
    </Card>
  );
}
