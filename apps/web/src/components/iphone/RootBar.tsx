"use client";

import { useQuery } from "convex/react";
import { useCapabilities } from "@/lib/mode";
import { Bell, MoreHorizontal } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { PersonalMark, WorkspaceLogo } from "@/components/app/WorkspaceMenu";
import { t } from "@/i18n";
import { GlassPill, PillButton } from "./Glass";
import { useIphoneActions } from "./IphoneShell";

/** Top left of Home, Tasks and Calendar: you (or the workspace you're in); opens the account and places sheet. */
export function RootAvatar() {
  const { openAccount } = useIphoneActions();
  const { workspace } = useAppState();
  return (
    <button
      type="button"
      aria-label={`${workspace ? workspace.name : "Personal"}: account and places`}
      onClick={openAccount}
      className="grid h-11 w-11 place-items-center rounded-capsule outline-none transition-transform active:scale-[0.92] focus-visible:ring-2 focus-visible:ring-focus"
    >
      {workspace ? <WorkspaceLogo workspace={workspace} size={34} className="shadow-[0_0_0_0.5px_rgb(0_0_0/0.12)]" /> : <PersonalMark size={34} className="!rounded-capsule shadow-[0_0_0_0.5px_rgb(0_0_0/0.12)]" />}
    </button>
  );
}

/** Top right of Home, Tasks and Calendar: notifications (with the unread count) and the screen's More menu. */
export function RootPill({ more, moreLabel = "More" }: { more?: MenuEntry[]; moreLabel?: string }) {
  const { openNotifications } = useIphoneActions();
  // Local mode has no notifications bell.
  const { notifications } = useCapabilities();
  const unread = useQuery(api.notifications.unreadCount, notifications ? {} : "skip") ?? 0;
  if (!notifications && !more?.length) return null;
  return (
    <GlassPill label="Screen actions">
      {notifications ? (
        <PillButton label={t("notifications.button.label", { count: unread })} onClick={openNotifications}>
          <Bell size={21} strokeWidth={1.9} aria-hidden />
          {unread ? <span aria-hidden className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-capsule bg-coral ring-2 ring-[var(--color-canvas)]" /> : null}
        </PillButton>
      ) : null}
      {more?.length ? <MoreMenu items={more} label={moreLabel} /> : null}
    </GlassPill>
  );
}

/** A "…" button in a glass pill, opening an iOS-style menu. */
export function MoreMenu({ items, label = "More" }: { items: MenuEntry[]; label?: string }) {
  return (
    <MenuButton
      label={label}
      align="end"
      triggerClassName="grid h-11 min-w-11 place-items-center rounded-capsule px-2.5 text-heading outline-none transition-transform active:scale-[0.92] focus-visible:ring-2 focus-visible:ring-focus"
      trigger={
        <span className="grid h-[23px] w-[23px] place-items-center rounded-capsule border-[1.8px] border-current">
          <MoreHorizontal size={15} strokeWidth={2.6} aria-hidden />
        </span>
      }
      items={items}
    />
  );
}
