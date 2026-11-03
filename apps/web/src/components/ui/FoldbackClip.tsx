import { createLucideIcon } from "lucide-react";
import { foldbackClipNode, foldbackClipOffNode } from "./foldbackClipNodes";

/**
 * A foldback clip, the Docked mark (in place of a star). Made with lucide's own createLucideIcon, so it takes
 * the same props as any lucide icon (size, strokeWidth, className, ...) and gets `lucide lucide-foldback-clip`.
 */
export const FoldbackClip = createLucideIcon("foldback-clip", foldbackClipNode);

/** The clip struck through: Undock. */
export const FoldbackClipOff = createLucideIcon("foldback-clip-off", foldbackClipOffNode);
