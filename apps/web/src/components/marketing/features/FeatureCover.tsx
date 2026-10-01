import type { ReactNode } from "react";
import type { Feature } from "../content/features";
import { coverPicture } from "./FeatureVisual";
import { ScaledPreview } from "./ScaledPreview";

/**
 * A card's cover on the features index: the app piece from the feature's own page, drawn at its natural
 * width and scaled into a 16:10 frame, holding still. `picture` (with its width) overrides it, for cards
 * that aren't feature pages, like the Mac app.
 */
export function FeatureCover({ feature, picture }: { feature?: Pick<Feature, "visual" | "art">; picture?: { width: number; node: ReactNode } }) {
  const cover = picture ?? (feature ? coverPicture(feature.visual, feature.art) : null);
  if (!cover) return null;
  return (
    <ScaledPreview width={cover.width} className="aspect-[16/10] bg-(--color-surface-sunken)">
      {cover.node}
    </ScaledPreview>
  );
}
