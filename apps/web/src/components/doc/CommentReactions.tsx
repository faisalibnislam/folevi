"use client";

// Reactions on a comment: six plain marks drawn as monochrome icons (never emoji), shown under the comment
// as "icon count" chips, and a picker opened from the comment's "Add reaction" button.
import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { FunctionArgs } from "convex/server";
import { Check, Eye, Heart, Laugh, Lightbulb, ThumbsUp, type LucideIcon } from "lucide-react";
import type { api } from "@/lib/convex/api";
import { Popover } from "@/components/ui/Popover";

export type ReactionKind = FunctionArgs<typeof api.comments.react>["kind"];
export type ReactionGroup = { kind: ReactionKind; count: number; mine: boolean; names: string[] };

/** In the order the server groups them (convex/lib/reactions.ts). */
export const REACTIONS: readonly { kind: ReactionKind; label: string; Icon: LucideIcon }[] = [
  { kind: "thumbsUp", label: "Agree", Icon: ThumbsUp },
  { kind: "heart", label: "Love it", Icon: Heart },
  { kind: "check", label: "Done", Icon: Check },
  { kind: "eyes", label: "Looking", Icon: Eye },
  { kind: "laugh", label: "Funny", Icon: Laugh },
  { kind: "idea", label: "Idea", Icon: Lightbulb },
];

const byKind = (kind: ReactionKind) => REACTIONS.find((r) => r.kind === kind)!;

/** Who reacted, in words: "You and Sam", "Ann, Bo and 3 more". */
export function reactedBy(r: ReactionGroup): string {
  const people = [...(r.mine ? ["You"] : []), ...r.names];
  const more = Math.max(0, r.count - people.length);
  if (more > 0) return `${people.join(", ")} and ${more} more`;
  if (people.length <= 1) return people[0] ?? "";
  return `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}`;
}

/** The comment's reactions after the caller toggles `kind` (for an instant answer before the server's). */
export function toggleReaction(reactions: ReactionGroup[], kind: ReactionKind): ReactionGroup[] {
  const found = reactions.find((r) => r.kind === kind);
  const next = found
    ? found.mine
      ? reactions.flatMap((r) => (r.kind !== kind ? [r] : r.count > 1 ? [{ ...r, count: r.count - 1, mine: false }] : []))
      : reactions.map((r) => (r.kind === kind ? { ...r, count: r.count + 1, mine: true } : r))
    : [...reactions, { kind, count: 1, mine: true, names: [] }];
  const order = (k: ReactionKind) => REACTIONS.findIndex((r) => r.kind === k);
  return next.sort((a, b) => order(a.kind) - order(b.kind));
}

/** The chips under a comment. Readers who can't comment see them without being able to press them. */
export function ReactionChips({ reactions, canReact, onToggle }: { reactions: ReactionGroup[]; canReact: boolean; onToggle: (kind: ReactionKind) => void }) {
  if (!reactions.length) return null;
  return (
    <div role="group" aria-label="Reactions" className="mt-1.5 flex flex-wrap items-center gap-1">
      {reactions.map((r) => {
        const { label, Icon } = byKind(r.kind);
        const who = `${label}: ${reactedBy(r)}`;
        const body = (
          <>
            <Icon size={12} aria-hidden />
            <span className="tabular-nums">{r.count}</span>
          </>
        );
        const cls = `inline-flex h-6 items-center gap-1 rounded-chip px-2 text-[11.5px] font-medium transition-colors ${
          r.mine ? "bg-[var(--glass-active)] text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.08)]" : "bg-[var(--glass-hover)] text-muted"
        }`;
        return canReact ? (
          <button key={r.kind} type="button" aria-pressed={r.mine} aria-label={`${label}, ${r.count}`} title={who} onClick={() => onToggle(r.kind)} className={`${cls} hover:text-heading`}>
            {body}
          </button>
        ) : (
          <span key={r.kind} title={who} className={cls}>
            {body}
            <span className="sr-only">{`${label}, ${r.count}`}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The six reactions in a small menu: arrow keys move between them, Enter or Space toggles, Escape closes. */
export function ReactionPicker({
  open,
  anchor,
  reactions,
  onToggle,
  onClose,
}: {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  reactions: ReactionGroup[];
  onToggle: (kind: ReactionKind) => void;
  onClose: () => void;
}) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  // The panel is hidden until it's placed, so focus the first reaction once it shows.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => items.current[0]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = items.current.findIndex((el) => el === document.activeElement);
    const move = (to: number) => {
      e.preventDefault();
      items.current[(to + REACTIONS.length) % REACTIONS.length]?.focus();
    };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(REACTIONS.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      // Close only the picker (not the comment card around it).
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchor.current?.focus();
    }
  };
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} label="Add reaction" align="end" className="w-auto">
      <div role="menu" aria-label="Reactions" aria-orientation="horizontal" className="flex gap-0.5 p-1" onKeyDown={onKeyDown}>
        {REACTIONS.map(({ kind, label, Icon }, i) => {
          const mine = reactions.some((r) => r.kind === kind && r.mine);
          return (
            <button
              key={kind}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemcheckbox"
              aria-checked={mine}
              aria-label={label}
              title={label}
              tabIndex={i === 0 ? 0 : -1}
              onClick={() => {
                onToggle(kind);
                onClose();
                anchor.current?.focus();
              }}
              className={`grid h-8 w-8 place-items-center rounded-chip transition-colors pointer-coarse:h-11 pointer-coarse:w-11 ${
                mine ? "bg-[var(--glass-active)] text-heading shadow-[var(--glass-edge)]" : "text-muted hover:bg-accent-soft hover:text-heading"
              }`}
            >
              <Icon size={15} aria-hidden />
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
