import { cx } from "./ui";

/*
 * The people in the website's pictures: one cast, each with a photo (public/marketing/people, 96 and 192 px
 * squares) and a colour for their cursor and highlights, so the same faces turn up everywhere someone is
 * shown (the hero's co-editors, comments, sharing, members, cursors). Decorative: the pictures they're in
 * describe them by name.
 */

export type PersonId = "maya" | "ines" | "sam" | "theo" | "jonas" | "alex";

export const PEOPLE: Record<PersonId, { name: string; full: string; color: string }> = {
  maya: { name: "Maya", full: "Maya Chen", color: "#6C5CE0" },
  ines: { name: "Ines", full: "Ines Moreau", color: "#22927F" },
  sam: { name: "Sam", full: "Sam Rivera", color: "#D9603F" },
  theo: { name: "Theo", full: "Theo Park", color: "#C2861B" },
  jonas: { name: "Jonas", full: "Jonas Berg", color: "#3B7DD8" },
  alex: { name: "Alex", full: "Alex Example", color: "#56565E" },
};

/** A person by first name, if they're in the cast. */
export const personNamed = (name: string): PersonId | null =>
  (Object.keys(PEOPLE) as PersonId[]).find((id) => PEOPLE[id].name === name || PEOPLE[id].full === name) ?? null;

/** A person's photo, round, `size` px. */
export function Avatar({ who, size = 24, className }: { who: PersonId; size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size decorative photos, already sized
    <img
      src={`/marketing/people/${who}.webp`}
      srcSet={`/marketing/people/${who}.webp 1x, /marketing/people/${who}@2x.webp 2x`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      className={cx("inline-block flex-none rounded-chip bg-(--color-surface-sunken) object-cover", className)}
      style={{ width: size, height: size }}
    />
  );
}
