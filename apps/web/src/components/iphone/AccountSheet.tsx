"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRightLeft, Check, HelpCircle, LogIn, LogOut, Plus, Settings } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { useSafeSignOut } from "@/components/auth/SignOut";
import { NewWorkspaceDialog } from "@/components/app/NewWorkspaceDialog";
import { AccountMark, LibraryMark, PersonalMark, WorkspaceLogo } from "@/components/app/WorkspaceMenu";
import { flushBeforeSwitch, placesAvailable, signInToAnotherAccount, switchToPlace, syncsWords, usePlaces, type AccountPlace, type Place } from "@/lib/places";
import { openMovePlaces } from "@/components/places/MovePlaces";
import { deviceWords } from "@/lib/shell/words";
import { currentBackendMode } from "@/lib/backendMode";
import { shell } from "@/lib/shell";
import type { LibraryKind } from "@/lib/shell/types";
import { Sheet } from "./Sheet";
import { GroupedSection, RowIcon } from "./Grouped";

/** An email cut in the middle when it doesn't fit: the start shrinks, "@domain" stays. */
function MiddleCut({ text }: { text: string }) {
  const at = text.lastIndexOf("@");
  const split = at > 0 && text.length - at <= 20 ? at : Math.max(0, text.length - 10);
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 truncate">{text.slice(0, split)}</span>
      <span className="flex-none whitespace-pre">{text.slice(split)}</span>
    </span>
  );
}

/**
 * One row of the sheet, in the phone's measure: 44 pt for an action or a workspace, about 60 for an account or the
 * library (its 36 pt picture, the name over the email). One check column at the end marks where you are.
 */
function Row({
  icon,
  label,
  description,
  detail,
  checked,
  sub,
  dot,
  badge,
  danger,
  ariaLabel,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  detail?: string;
  /** A place (checked or not): keeps the check column. Undefined for an action. */
  checked?: boolean;
  /** Under the account above it (a workspace). */
  sub?: boolean;
  dot?: boolean;
  badge?: number;
  danger?: boolean;
  ariaLabel?: string;
  onClick: () => void;
}) {
  const place = !sub && checked !== undefined;
  // The hairline above the row starts at its words, past its picture.
  const style = { ["--sep-inset" as string]: sub ? "100px" : place ? "64px" : "58px" } as CSSProperties;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={checked}
      aria-description={[description, detail, badge ? `${badge} unread` : null, dot && !badge ? "something new" : null].filter(Boolean).join(" · ") || undefined}
      data-row={sub ? "sub" : place ? "place" : undefined}
      className={`ui-key-focus flex w-full items-center gap-3 pr-4 text-left outline-none transition-colors duration-150 active:bg-[var(--liquid-press)] active:duration-0 ${place ? "min-h-[60px] py-2 pl-4" : "min-h-11"} ${sub ? "pl-16" : place ? "" : "pl-4"}`}
      style={style}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-body leading-[22px] ${danger ? "text-danger" : place ? "font-medium text-heading" : "text-ink"}`}>{label}</span>
        {description ? (
          <span className="mt-px block text-subheadline leading-[18px] text-muted">
            <MiddleCut text={description} />
          </span>
        ) : null}
      </span>
      {detail ? <span className="flex-none text-subheadline leading-5 text-muted">{detail}</span> : null}
      {badge ? (
        <span aria-hidden className="grid h-5 min-w-5 flex-none place-items-center rounded-chip bg-coral px-1.5 text-caption-1 font-semibold leading-none text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : dot ? (
        <span aria-hidden className="h-2 w-2 flex-none rounded-tiny bg-coral" />
      ) : null}
      {checked !== undefined ? <span aria-hidden className="flex w-5 flex-none justify-center text-heading">{checked ? <Check size={20} strokeWidth={2.4} /> : null}</span> : null}
    </button>
  );
}

/** The library's 36 pt mark: its device on a quiet tile. */
function LibraryTile() {
  return (
    <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-small bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] text-muted">
      <LibraryMark size={20} />
    </span>
  );
}

/** Where this device's library syncs, in words. */
function useLibrarySyncs(places: Place[]): string {
  const listed = places.find((p) => p.kind === "library")?.syncs ?? null;
  const [kind, setKind] = useState<LibraryKind | null>(null);
  useEffect(() => {
    if (listed) return;
    let live = true;
    void shell()
      ?.library?.info()
      .then(
        (info) => live && setKind(info.kind),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [listed]);
  return listed ?? (kind ? syncsWords(kind) : "On your devices");
}

/**
 * The avatar's sheet (top left of Home, Tasks and Calendar): the same as the sidebar's account menu, in the phone's
 * measure. Places first (each account with its workspaces under it, the library "On this iPhone"), then Settings,
 * Sign in to another account, Move or copy notes and Help, then Sign out. Plan and billing, Security, Devices,
 * Contact support, Admin console and the theme are in Settings.
 */
export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { context, workspaces, setContext, profile, engine, outbox } = useAppState();
  // Several places (docs/MULTI_ACCOUNT_PLAN.md): the other accounts and the library on this device.
  const { places, current } = usePlaces();
  const several = placesAvailable();
  const listed = several ? places : [];
  const local = currentBackendMode() === "local";
  const syncs = useLibrarySyncs(listed);
  const openPlace = (p: Place, workspaceId?: string | null) => {
    onClose();
    void switchToPlace(p, { workspaceId, flush: () => flushBeforeSwitch({ engine, outbox }) });
  };
  const { navigate, route } = useAppRouter();
  const safeSignOut = useSafeSignOut(profile.id);
  const [creating, setCreating] = useState(false);
  const go = (href: string) => {
    onClose();
    navigate(href);
  };
  const switchTo = (next: WireScope) => {
    const same = next.kind === context.kind && (next.kind === "personal" || (context.kind === "workspace" && context.workspaceId === next.workspaceId));
    setContext(next);
    onClose();
    if (!same && route.name !== "documents" && route.name !== "tasks" && route.name !== "calendar") navigate("/documents");
  };
  const email = (profile as { email?: string }).email ?? "";
  const where = deviceWords().here;

  let accounts: (AccountPlace | null)[] = listed.filter((p): p is AccountPlace => p.kind === "account");
  if (!local && !accounts.some((p) => p?.id === current)) accounts = [null, ...accounts];
  const library = listed.find((p) => p.kind === "library");
  const others = listed.some((p) => p.id !== current);

  const rows: ReactNode[] = [];
  for (const p of accounts) {
    if (!local && (p === null || p.id === current)) {
      rows.push(
        <Row key="me" icon={<PersonalMark size={36} className="!rounded-capsule" />} label={profile.displayName || email || "Personal"} ariaLabel="Personal" description={email || undefined} checked={context.kind === "personal"} onClick={() => switchTo({ kind: "personal" })} />,
      );
      for (const w of workspaces) {
        rows.push(
          <Row
            key={w.id}
            sub
            icon={<WorkspaceLogo workspace={w} size={24} />}
            label={w.name}
            detail={w.plan.shortName}
            checked={context.kind === "workspace" && context.workspaceId === w.id}
            onClick={() => switchTo({ kind: "workspace", workspaceId: w.id })}
          />,
        );
      }
      rows.push(<Row key="new" sub icon={<span aria-hidden className="grid h-6 w-6 flex-none place-items-center text-muted"><Plus size={18} /></span>} label="New workspace…" onClick={() => setCreating(true)} />);
      continue;
    }
    if (!p) continue;
    rows.push(
      <Row key={p.id} icon={<AccountMark name={p.name || p.email} avatarUrl={p.avatarUrl} size={36} className="!rounded-capsule" />} label={p.name || p.email || "Folevi account"} description={p.name ? p.email || undefined : undefined} checked={false} badge={p.unread} dot={p.reminders > 0} onClick={() => openPlace(p, null)} />,
    );
    for (const w of p.workspaces) rows.push(<Row key={`${p.id}:${w.id}`} sub icon={<WorkspaceLogo workspace={w} size={24} />} label={w.name} checked={false} onClick={() => openPlace(p, w.id)} />);
  }
  if (local) rows.push(<Row key="library" icon={<LibraryTile />} label={`On ${where}`} description={syncs} checked onClick={onClose} />);
  else if (library) rows.push(<Row key="library" icon={<LibraryTile />} label={`On ${where}`} description={library.syncs} checked={false} dot={library.reminders > 0 || library.waiting > 0} onClick={() => openPlace(library)} />);

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Account" size="medium" snapMedium="section" bodyClassName="pb-6">
        <GroupedSection title="Places" className="pt-2">
          {rows}
        </GroupedSection>
        <GroupedSection className="mt-6">
          <Row icon={<RowIcon><Settings /></RowIcon>} label="Settings" onClick={() => go("/settings")} />
          {several ? (
            <Row
              icon={<RowIcon><LogIn /></RowIcon>}
              label="Sign in to another account…"
              onClick={() => {
                onClose();
                void signInToAnotherAccount();
              }}
            />
          ) : null}
          {others ? (
            <Row
              icon={<RowIcon><ArrowRightLeft /></RowIcon>}
              label="Move or copy notes…"
              onClick={() => {
                onClose();
                openMovePlaces();
              }}
            />
          ) : null}
          <Row icon={<RowIcon><HelpCircle /></RowIcon>} label="Help" onClick={() => go("/help")} />
        </GroupedSection>
        <GroupedSection className="mt-6">
          <Row
            icon={<RowIcon tone="color-mix(in oklab, var(--color-destructive) 14%, transparent)"><LogOut className="text-danger" /></RowIcon>}
            label={local ? "Sign out" : `Sign out of ${profile.displayName || "this account"}`}
            danger
            onClick={() => void safeSignOut.request()}
          />
        </GroupedSection>
      </Sheet>
      <NewWorkspaceDialog open={creating} onClose={() => setCreating(false)} onCreated={() => go("/documents")} />
      {safeSignOut.dialog}
    </>
  );
}
