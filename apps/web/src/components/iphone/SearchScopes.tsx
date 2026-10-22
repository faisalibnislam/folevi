"use client";

import { ChevronDown } from "lucide-react";
import { feel } from "@/lib/native/ui";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";

type ScopeChoice = { id: string; label: string; name: string };
type Filters = { folderId?: string; tagId?: string; creatorId?: string; updated?: "7" | "30" | "365" };
const UPDATED: { id: NonNullable<Filters["updated"]>; label: string }[] = [
  { id: "7", label: "Past week" },
  { id: "30", label: "Past month" },
  { id: "365", label: "Past year" },
];

/**
 * The iPhone search's scope bar: borderless capsules (32 pt, 15 pt text) that each open a menu, the ones in
 * use filled with what they're set to. Where you search (this place or all of them) comes first when there
 * are several places.
 */
export function IphoneScopes({
  folders,
  tags,
  people,
  filters,
  onFilters,
  place,
}: {
  folders: ScopeChoice[];
  tags: ScopeChoice[];
  people: ScopeChoice[] | null;
  filters: Filters;
  onFilters: (f: Filters) => void;
  place: { here: string; all: boolean; onAll: (all: boolean) => void } | null;
}) {
  const set = (patch: Filters) => {
    feel("choose");
    onFilters({ ...filters, ...patch });
  };
  const where = (all: boolean) => {
    if (!place || all === place.all) return;
    feel("choose");
    place.onAll(all);
  };
  const locked = Boolean(place?.all);
  const scope = (key: string, label: string, chosen: string | undefined, items: MenuEntry[], disabled = false) => (
    <MenuButton
      key={key}
      label={chosen ? `${label}: ${chosen}` : label}
      align="start"
      className="flex-none"
      triggerClassName={`group grid h-11 flex-none place-items-center outline-none ${disabled ? "pointer-events-none opacity-40" : ""}`}
      trigger={
        <span
          className={`flex h-8 max-w-[180px] items-center gap-1 rounded-capsule pl-3.5 pr-2.5 text-[15px] leading-5 transition-colors group-active:scale-[0.96] group-focus-visible:ring-2 group-focus-visible:ring-focus ${
            chosen ? "bg-heading font-medium text-canvas" : "bg-[color-mix(in_oklab,var(--color-ink)_6.5%,transparent)] text-ink"
          }`}
        >
          <span className="truncate">{chosen ?? label}</span>
          <ChevronDown size={14} strokeWidth={2.4} aria-hidden className={`flex-none ${chosen ? "opacity-70" : "text-muted"}`} />
        </span>
      }
      items={items}
    />
  );
  const choose = (all: ScopeChoice[], current: string | undefined, anyLabel: string, apply: (id: string | undefined) => void): MenuEntry[] => [
    { label: anyLabel, checked: !current, onSelect: () => apply(undefined) },
    ...(all.length ? (["separator"] as MenuEntry[]) : []),
    ...all.map((c) => ({ label: c.label, checked: current === c.id, onSelect: () => apply(c.id) })),
  ];
  return (
    <div role="group" aria-label="Search filters" className="flex flex-none items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {place
        ? scope("where", place.here, place.all ? "All places" : undefined, [
            { label: place.here, checked: !place.all, onSelect: () => where(false) },
            { label: "All places", checked: place.all, onSelect: () => where(true) },
          ])
        : null}
      {scope("folder", "Folder", folders.find((f) => f.id === filters.folderId)?.name, choose(folders, filters.folderId, "Any folder", (folderId) => set({ folderId })), locked)}
      {tags.length ? scope("tag", "Tag", tags.find((t) => t.id === filters.tagId)?.name, choose(tags, filters.tagId, "Any tag", (tagId) => set({ tagId })), locked) : null}
      {people ? scope("person", "Created by", people.find((p) => p.id === filters.creatorId)?.name, choose(people, filters.creatorId, "Anyone", (creatorId) => set({ creatorId })), locked) : null}
      {scope(
        "updated",
        "Edited",
        UPDATED.find((u) => u.id === filters.updated)?.label,
        [{ label: "Any time", checked: !filters.updated, onSelect: () => set({ updated: undefined }) }, "separator", ...UPDATED.map((u) => ({ label: u.label, checked: filters.updated === u.id, onSelect: () => set({ updated: u.id }) }))],
      )}
    </div>
  );
}
