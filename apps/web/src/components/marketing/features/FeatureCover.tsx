import type { ReactNode } from "react";
import type { Feature } from "../content/features";
import { coverPicture } from "./FeatureVisual";
import { ScaledPreview } from "./ScaledPreview";
import { cx } from "../ui";

/**
 * A card's cover on the features index: the app piece from the feature's own page, drawn at its natural
 * width and scaled into its frame (16:10 by default), holding still. `picture` (with its width) overrides it, for cards
 * that aren't feature pages, like the Mac app.
 */
export function FeatureCover({
  feature,
  picture,
  className = "aspect-[16/10]",
}: {
  feature?: Pick<Feature, "visual" | "art">;
  picture?: { width: number; node: ReactNode };
  /** The frame's size; 16:10 unless the card sets its own (the features index lets covers grow). */
  className?: string;
}) {
  const cover = picture ?? (feature ? coverPicture(feature.visual, feature.art) : null);
  if (!cover) return null;
  return (
    <ScaledPreview width={cover.width} className={cx(className, "bg-(--color-surface-sunken)")}>
      {cover.node}
    </ScaledPreview>
  );
}
