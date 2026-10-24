"use client";
// An encrypted share link (docs/E2EE_DESIGN.md §9.1, WP8): the page's HTML carries only ciphertext. Here, in
// the reader's browser, the key from the URL fragment (#k=…, never sent to any server) opens the note key,
// then the title, look, blocks and files, and the note is drawn read-only like any shared page.
import { useEffect, useState } from "react";
import type { WireBlock } from "@folevi/editor-schema";
import { ReadOnlyBlocks } from "@/components/doc/ReadOnlyBlocks";
import { copy } from "@/lib/e2ee/copy";
import { openShare, type OpenedShare } from "@/lib/e2ee/links";
import type { SharePayload } from "@/lib/e2ee/sharePayload";

type State = { kind: "opening" } | { kind: "missing" } | { kind: "ok"; share: OpenedShare };

export function EncryptedShare({ payload, updatedLabel }: { payload: SharePayload; updatedLabel: string }) {
  const [state, setState] = useState<State>({ kind: "opening" });

  useEffect(() => {
    let alive = true;
    let urls: string[] = [];
    void openShare(payload, window.location.hash).then(
      (r) => {
        if (!alive) {
          if (r.ok) for (const u of Object.values(r.share.fileUrls)) URL.revokeObjectURL(u);
          return;
        }
        if (!r.ok) return setState({ kind: "missing" });
        urls = Object.values(r.share.fileUrls);
        document.title = r.share.title || "Untitled";
        setState({ kind: "ok", share: r.share });
      },
      () => alive && setState({ kind: "missing" }),
    );
    return () => {
      alive = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [payload]);

  if (state.kind === "opening") {
    return (
      <div className="mx-auto mt-24 max-w-md text-center" aria-busy="true">
        <p className="text-muted">Opening the encrypted note…</p>
      </div>
    );
  }
  if (state.kind === "missing") {
    return (
      <div className="mx-auto mt-24 max-w-md text-center">
        <h1 className="ui-display text-large-title">Page unavailable</h1>
        <p role="alert" className="mt-3 text-muted">
          {copy.share.missingKey}
        </p>
      </div>
    );
  }
  const { share } = state;
  return (
    <article className="fb-page fb-sheet relative mx-auto w-full max-w-[calc(var(--editor-width)+8rem)] min-w-0 rounded-control border border-line" data-publish="note">
      <div className="h-8" />
      <div className="px-5 pb-6 pt-4 sm:px-16">
        <h1 className="mt-2 px-0.5 text-[40px] font-semibold leading-tight tracking-tight">{share.title || "Untitled"}</h1>
        <p className="mb-6 mt-1 px-0.5 text-footnote text-muted">{updatedLabel}</p>
        <ReadOnlyBlocks blocks={share.blocks as WireBlock[]} fileUrls={share.fileUrls} collections={share.collections as never} />
      </div>
    </article>
  );
}
