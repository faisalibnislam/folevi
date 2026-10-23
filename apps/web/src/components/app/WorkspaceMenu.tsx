"use client";

import { useEffect, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { ArrowRightLeft, ChevronsUpDown, HelpCircle, Laptop, LogIn, LogOut, Smartphone, Plus, Settings, Tablet } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { TIER_NAMES, TRIAL_TIER } from "@/lib/plans";
import { useAppState, type Workspace } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { useSafeSignOut } from "@/components/auth/SignOut";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { canPurchaseHere } from "@/lib/nativeApp";
import { isShell, shell } from "@/lib/shell";
import type { LibraryKind } from "@/lib/shell/types";
import { APP_URL } from "@/lib/env";
import { useCapabilities } from "@/lib/mode";
import { flushBeforeSwitch, LIBRARY_PLACE, placesAvailable, signInToAnotherAccount, switchToPlace, syncsWords, usePlaces, type AccountPlace, type Place, type PlaceId } from "@/lib/places";
import { MAX_BROWSER_ACCOUNTS } from "@/lib/places/web";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { deviceWords } from "@/lib/shell/words";
import { openMovePlaces } from "@/components/places/MovePlaces";
import "./accountMenu.css";

// The console is part of the website; the bundled app shell has no /admin, so it opens there in the browser.
export const openAdminConsole = () => (isShell() ? void window.open(`${APP_URL}/admin`, "_blank", "noopener") : void (window.location.href = "/admin"));

/** A team workspace's mark: its square logo, or its initial on a neutral tile. */
export function WorkspaceLogo({ workspace, size = 24, className = "" }: { workspace: Pick<Workspace, "name" | "logoUrl">; size?: number; className?: string }) {
  return <Mark src={workspace.logoUrl ?? null} initial={workspace.name} shape="rounded-chip" size={size} className={className} />;
}

/** Personal's mark: your profile picture (or your initial), drawn round. Personal is you, not a workspace. */
export function PersonalMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  const { profile } = useAppState();
  return <Mark src={profile.avatarUrl ?? null} initial={profile.displayName} shape="rounded-chip" size={size} className={className} />;
}

function Mark({ src, initial, shape, size, className }: { src: string | null; initial: string; shape: string; size: number; className: string }) {
  const letter = initial.trim().slice(0, 1).toUpperCase() || "·";
  // A picture whose link ran out (another account's, remembered from when it was open) shows the initial.
  const [broken, setBroken] = useState<string | null>(null);
  return src && broken !== src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny signed storage URL, not an optimisable asset
    <img src={src} alt="" width={size} height={size} onError={() => setBroken(src)} className={`flex-none object-cover ${shape} ${className}`} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className={`grid flex-none place-items-center bg-heading font-semibold text-canvas ${shape} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {letter}
    </span>
  );
}

/** Another account's mark (its picture or initial), for the switcher. */
export function AccountMark({ name, avatarUrl, size = 26, className = "" }: { name: string; avatarUrl: string | null; size?: number; className?: string }) {
  return <Mark src={avatarUrl} initial={name || "?"} shape="rounded-chip" size={size} className={className} />;
}

/** The library's mark: the device it lives on. */
export function LibraryMark({ size = 16 }: { size?: number }) {
  const noun = deviceWords().noun;
  return noun === "Mac" ? <Laptop size={size} /> : noun === "iPad" || noun === "tablet" ? <Tablet size={size} /> : <Smartphone size={size} />;
}

/** The library's 36 pt mark in the account menu: its device on a quiet tile. */
function LibraryTile({ size = 36 }: { size?: number }) {
  return (
    <span aria-hidden className="grid flex-none place-items-center rounded-chip bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] text-muted" style={{ width: size, height: size }}>
      <LibraryMark size={18} />
    </span>
  );
}

/** A small mark the size of a workspace's logo, for "New workspace…" under an account. */
function SubIcon({ children }: { children: React.ReactNode }) {
  return <span aria-hidden className="grid h-5 w-5 flex-none place-items-center text-muted">{children}</span>;
}

/** Where you are now, for the list of places. */
export type HerePlace =
  | {
      kind: "account";
      /** This account's place id (null when this page doesn't know several). */
      id: PlaceId | null;
      name: string;
      email: string;
      /** In Personal (not one of the workspaces). */
      personal: boolean;
      workspaces: { id: string; name: string; logoUrl: string | null; plan: string; open: boolean }[];
      pickPersonal: () => void;
      pickWorkspace: (id: string) => void;
      newWorkspace: () => void;
    }
  | { kind: "library"; syncs: string };

/**
 * The account menu's places (docs/MULTI_ACCOUNT_PLAN.md, Owner decisions): a quiet "Places" label, then each
 * account (its picture, name and email) with its workspaces under it (and "New workspace…" under the open one),
 * then the library ("On this Mac", where it syncs). One check column marks where you are; dots say what's new
 * elsewhere. Picking another place opens it (this tab reloads into it).
 */
export function placeEntries(places: Place[], here: HerePlace, open: (place: Place, workspaceId?: string | null) => void): MenuEntry[] {
  const out: MenuEntry[] = [{ heading: "Places" }];
  const where = deviceWords().here;
  let accounts: (AccountPlace | null)[] = places.filter((p): p is AccountPlace => p.kind === "account");
  // (The open account always shows, first when the list doesn't have it yet.)
  if (here.kind === "account" && !accounts.some((p) => p?.id === here.id)) accounts = [null, ...accounts];
  for (const p of accounts) {
    if (here.kind === "account" && (p === null || p.id === here.id)) {
      out.push({
        label: here.name || here.email || "Personal",
        // Picking it opens Personal: that's what it is to assistive tech, and the e2e helpers' switchTo("Personal").
        name: "Personal",
        description: here.email || undefined,
        middle: true,
        row: "place",
        icon: <PersonalMark size={36} />,
        checked: here.personal,
        onSelect: here.pickPersonal,
      });
      for (const w of here.workspaces) {
        out.push({ label: w.name, detail: w.plan, row: "sub", icon: <WorkspaceLogo workspace={w} size={20} />, checked: w.open, onSelect: () => here.pickWorkspace(w.id) });
      }
      out.push({ label: "New workspace…", row: "sub", icon: <SubIcon><Plus size={14} /></SubIcon>, onSelect: here.newWorkspace });
      continue;
    }
    if (!p) continue;
    out.push({
      label: p.name || p.email || "Folevi account",
      description: p.name ? p.email || undefined : undefined,
      middle: true,
      row: "place",
      icon: <AccountMark name={p.name || p.email} avatarUrl={p.avatarUrl} size={36} />,
      badge: p.unread,
      dot: p.reminders > 0,
      onSelect: () => open(p, null),
    });
    for (const w of p.workspaces) out.push({ label: w.name, row: "sub", icon: <WorkspaceLogo workspace={w} size={20} />, onSelect: () => open(p, w.id) });
  }
  const library = places.find((p) => p.kind === "library");
  if (here.kind === "library") {
    out.push({ label: `On ${where}`, description: library?.syncs ?? here.syncs, row: "place", icon: <LibraryTile />, checked: true, onSelect: () => undefined });
  } else if (library) {
    out.push({ label: `On ${where}`, description: library.syncs, row: "place", icon: <LibraryTile />, dot: library.reminders > 0 || library.waiting > 0, onSelect: () => open(library) });
  }
  return out;
}

/** Where this device's library syncs, in words ("Kept on this device only", "Syncs with iCloud Drive"). */
function useLibrarySyncs(places: Place[]): string {
  const listed = places.find((p) => p.kind === "library")?.syncs ?? null;
  const [kind, setKind] = useState<LibraryKind | null | undefined>(undefined);
  useEffect(() => {
    if (listed) return;
    let live = true;
    void shell()
      ?.library?.info()
      .then(
        (info) => live && setKind(info.kind),
        () => live && setKind(null),
      );
    return () => {
      live = false;
    };
  }, [listed]);
  return listed ?? (kind ? syncsWords(kind) : "On your devices");
}

/** Opens another place, writing out what's waiting here first. */
function usePlaceSwitch() {
  const { engine, outbox } = useAppState();
  const toast = useToast();
  return (place: Place, workspaceId?: string | null) =>
    void switchToPlace(place, { workspaceId, flush: () => flushBeforeSwitch({ engine, outbox }) }).catch((e: unknown) => toast.show(errorMessage(e), { tone: "error" }));
}

/** Settings, signing in to one more account, moving notes between places, Help: the account menu's actions. */
function actionEntries(o: { go: (href: string) => void; several: boolean; others: boolean; full?: boolean }): MenuEntry[] {
  return [
    // (⌘, opens Settings: Shell.tsx on the web, the menu bar's Settings window in the Mac app.)
    { label: "Settings", icon: <Settings size={16} />, shortcut: "⌘,", onSelect: () => o.go("/settings") },
    ...(o.several
      ? [
          {
            label: "Sign in to another account…",
            icon: <LogIn size={16} />,
            disabled: o.full,
            ...(o.full ? { description: `Up to ${MAX_BROWSER_ACCOUNTS} accounts in one browser` } : {}),
            onSelect: () => void signInToAnotherAccount(),
          },
        ]
      : []),
    ...(o.others ? [{ label: "Move or copy notes…", icon: <ArrowRightLeft size={16} />, onSelect: () => openMovePlaces() }] : []),
    { label: "Help", icon: <HelpCircle size={16} />, onSelect: () => o.go("/help") },
  ];
}

/** The account menu's look: about 300 wide, opening up from the button without covering it. */
const MENU = { variant: "switcher", clear: true, side: "top", align: "start", className: "w-full" } as const;
const TRIGGER =
  "flex h-12 w-full items-center gap-2.5 rounded-chip px-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)]";

/**
 * The bottom of the sidebar: where you are (Personal, a team workspace or the library) and you. Its menu lists
 * your places first, then Settings, Sign in to another account, Move or copy notes and Help, then Sign out. Plan
 * and billing, Security, Devices, Contact support, Admin console and the theme are in Settings.
 */
export function WorkspaceMenu({ onNavigate }: { onNavigate?: () => void }) {
  // Local mode has no workspaces, account or plan: the library's own menu instead (docs/LOCAL_MODE_PLAN.md §5.2).
  if (!useCapabilities().workspaces) return <LibraryMenu onNavigate={onNavigate} />;
  return <AccountMenu onNavigate={onNavigate} />;
}

/** Local mode's foot of the sidebar: you, and the same menu with the library checked. */
function LibraryMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useAppState();
  const { navigate } = useAppRouter();
  const { places, current } = usePlaces();
  const open = usePlaceSwitch();
  const several = placesAvailable();
  const syncs = useLibrarySyncs(places);
  const go = (href: string) => {
    onNavigate?.();
    navigate(href);
  };
  const others = places.some((p) => p.id !== current && p.id !== LIBRARY_PLACE);
  const items: MenuEntry[] = [...placeEntries(several ? places : [], { kind: "library", syncs }, open), "separator", ...actionEntries({ go, several, others })];
  return (
    <MenuButton
      {...MENU}
      label={`${profile.displayName}: settings and help`}
      triggerClassName={TRIGGER}
      items={items}
      trigger={
        <>
          <PersonalMark size={28} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13.5px] font-semibold text-heading">{profile.displayName}</span>
            <span className="block truncate text-[11.5px] text-muted">On your devices</span>
          </span>
          <ChevronsUpDown size={14} aria-hidden className="flex-none text-faint" />
        </>
      }
    />
  );
}

function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { context, workspace, workspaces, setContext, profile } = useAppState();
  const { navigate, route } = useAppRouter();
  const safeSignOut = useSafeSignOut(profile.id);
  const { places, current } = usePlaces();
  const open = usePlaceSwitch();
  const several = placesAvailable();
  const accounts = places.filter((p) => p.kind === "account").length;
  const full = !isShell() && accounts >= MAX_BROWSER_ACCOUNTS;
  const [creating, setCreating] = useState(false);
  const go = (href: string) => {
    onNavigate?.();
    navigate(href);
  };
  // A page, folder or tag belongs to one context (and each context has its own tabs): switching away from
  // one goes to the new context's Home instead of leaving the old context's page open without a tab.
  const switchTo = (next: WireScope) => {
    const same = next.kind === context.kind && (next.kind === "personal" || (context.kind === "workspace" && context.workspaceId === next.workspaceId));
    setContext(next);
    if (!same && (route.name === "doc" || route.name === "folder" || route.name === "tag")) go("/documents");
  };
  const here: HerePlace = {
    kind: "account",
    id: current,
    name: profile.displayName,
    email: profile.email ?? "",
    personal: context.kind === "personal",
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, logoUrl: w.logoUrl ?? null, plan: w.plan.shortName, open: context.kind === "workspace" && context.workspaceId === w.id })),
    pickPersonal: () => switchTo({ kind: "personal" }),
    pickWorkspace: (id) => switchTo({ kind: "workspace", workspaceId: id }),
    newWorkspace: () => setCreating(true),
  };
  const others = several && places.some((p) => p.id !== current);
  const items: MenuEntry[] = [
    ...placeEntries(several ? places : [], here, open),
    "separator",
    ...actionEntries({ go, several, others, full }),
    "separator",
    // Only this account: the others stay signed in. Warns (and asks for an explicit choice) if anything of it on
    // this device hasn't synced yet.
    { label: `Sign out of ${profile.displayName || "this account"}`, icon: <LogOut size={16} />, onSelect: () => void safeSignOut.request() },
  ];

  // Personal plan: trial days left, or an upgrade nudge on Free; nothing once they're paying. Only shown in
  // Personal, since a Personal plan doesn't change what a team workspace includes. In the iOS app only the
  // trial's days, and not as a way to plans (no buying there).
  const store = canPurchaseHere();
  const ent = (profile as { entitlements?: { trialing: boolean; trialEndsAt: number | null; paid?: boolean } }).entitlements;
  const trialDays = ent?.trialing && ent.trialEndsAt ? Math.max(1, Math.ceil((ent.trialEndsAt - Date.now()) / 86_400_000)) : 0;
  const pill = !ent || context.kind !== "personal" ? null : ent.trialing ? `${TIER_NAMES[TRIAL_TIER]} trial · ${trialDays} ${trialDays === 1 ? "day" : "days"} left` : ent.paid === false && store ? "Upgrade to Pro" : null;
  const title = workspace ? workspace.name : profile.displayName;

  return (
    <>
      {pill && !store ? (
        <p className="mb-1.5 flex h-8 w-full items-center gap-1.5 rounded-chip bg-[linear-gradient(100deg,color-mix(in_oklab,#8b7cf6_14%,transparent),color-mix(in_oklab,#f58ab8_12%,transparent))] px-2 text-xs font-medium text-heading shadow-[inset_0_0_0_1px_var(--glass-border)]">
          <AiIcon size={13} aria-hidden className="text-[#7c6cf0]" />
          <span className="flex-1 truncate">{pill}</span>
        </p>
      ) : pill ? (
        <button
          type="button"
          onClick={() => go("/settings/billing")}
          className="mb-1.5 flex h-8 w-full items-center gap-1.5 rounded-chip bg-[linear-gradient(100deg,color-mix(in_oklab,#8b7cf6_14%,transparent),color-mix(in_oklab,#f58ab8_12%,transparent))] px-2 text-left text-xs font-medium text-heading shadow-[inset_0_0_0_1px_var(--glass-border)] transition-[filter] hover:brightness-[1.03]"
        >
          <AiIcon size={13} aria-hidden className="text-[#7c6cf0]" />
          <span className="flex-1 truncate">{pill}</span>
          <span className="flex-none text-[11.5px] text-muted">{ent?.trialing ? "Choose plan" : "See plans"}</span>
        </button>
      ) : null}
      <MenuButton
        {...MENU}
        label={`${workspace ? workspace.name : "Personal"}: Personal, workspaces and account`}
        triggerClassName={TRIGGER}
        items={items}
        trigger={
          <>
            {workspace ? <WorkspaceLogo workspace={workspace} size={28} /> : <PersonalMark size={28} />}
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold text-heading">{title}</span>
              <span className="block truncate text-[11.5px] text-muted">{workspace ? profile.displayName : "Personal"}</span>
            </span>
            <ChevronsUpDown size={14} aria-hidden className="flex-none text-faint" />
          </>
        }
      />
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={() => go("/documents")} />
      {safeSignOut.dialog}
    </>
  );
}
