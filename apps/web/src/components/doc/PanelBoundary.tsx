"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { isChunkLoadError } from "@/components/editor/NodeViews";

/**
 * Around a part of the note's tools panel that loads the first time it shows (Foli AI). When that part can't be
 * fetched (no connection, or the website was updated since the page opened) the panel says so and offers to try
 * again, and the note stays as it is. The failure used to reach the page's own error screen, and since a note
 * opens with Foli AI's panel, a note opened offline before that part had ever loaded could not be read at all
 * (found 2026-11-19, e2e/ios-native.spec.ts). Any other error is not this one's to hide: it goes on up.
 *
 * `children` gets the number of the try, so the caller can ask for the part again (React's `lazy` keeps a
 * failed load for good).
 */
export class PanelBoundary extends Component<{ name: string; children: (attempt: number) => ReactNode }, { error: unknown; attempt: number }> {
  override state = { error: null as unknown, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  private retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  override render() {
    const { error, attempt } = this.state;
    if (error === null) return this.props.children(attempt);
    if (!isChunkLoadError(error)) throw error;
    return (
      <div role="status" data-panel-unloaded="" className="flex flex-col items-start gap-3 px-1 py-2 text-subheadline text-muted">
        <p>{this.props.name} couldn’t load. Check your connection, then try again.</p>
        <Button size="sm" onClick={this.retry}>
          Try again
        </Button>
      </div>
    );
  }
}
