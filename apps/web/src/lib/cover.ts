// Shared (server + client) cover/accent helpers.
import type { DocumentCover, DocumentStyle } from "@folevi/editor-schema";

export const accentVar = (a: DocumentStyle["accent"]) => (a === "accent" ? "var(--color-accent)" : `var(--color-${a})`);
export const softVar = (a: DocumentStyle["accent"]) => (a === "accent" ? "var(--color-accent-soft)" : `var(--color-${a}-soft)`);

export function coverBackground(cover: DocumentCover, style: DocumentStyle): string | undefined {
  if (cover.kind === "color") return softVar((cover.value as DocumentStyle["accent"]) ?? style.accent);
  if (cover.kind === "gradient") {
    const a = (cover.value as DocumentStyle["accent"]) ?? style.accent;
    return `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${accentVar(a)} 38%, transparent) 0%, transparent 60%), linear-gradient(135deg, ${softVar(a)} 0%, var(--color-surface) 100%)`;
  }
  return undefined;
}

