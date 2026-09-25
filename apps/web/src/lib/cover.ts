// Shared (server + client) cover/accent helpers.
import type { DocumentCover, DocumentStyle } from "@folevi/editor-schema";

// The "Accent" page accent renders ember (docs/DESIGN_SYSTEM.md); the Mac app uses the same rule.
export const accentVar = (a: DocumentStyle["accent"]) => (a === "accent" ? "var(--color-ember)" : `var(--color-${a})`);
export const softVar = (a: DocumentStyle["accent"]) => (a === "accent" ? "var(--color-ember-soft)" : `var(--color-${a}-soft)`);

export function coverBackground(cover: DocumentCover, style: DocumentStyle): string | undefined {
  if (cover.kind === "color") return softVar((cover.value as DocumentStyle["accent"]) ?? style.accent);
  if (cover.kind === "gradient") {
    const a = (cover.value as DocumentStyle["accent"]) ?? style.accent;
    return `radial-gradient(85% 150% at 100% 0%, color-mix(in oklab, ${accentVar(a)} 50%, transparent) 0%, transparent 62%), radial-gradient(70% 130% at 0% 100%, color-mix(in oklab, var(--color-glow-rose) 65%, transparent) 0%, transparent 66%), linear-gradient(135deg, ${softVar(a)} 0%, color-mix(in oklab, ${softVar(a)} 45%, var(--color-surface)) 100%)`;
  }
  return undefined;
}

