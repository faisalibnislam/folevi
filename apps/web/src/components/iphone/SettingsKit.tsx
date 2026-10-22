"use client";

// Settings in the iPhone app (and the iPad app in a compact window), the way iOS Settings is built: inset
// grouped sections with a heading above and an explanation under them; rows with a label at the start and a
// value, a switch or a chevron at the end, split by hairlines that start past the row's icon; every choice
// (a theme, a time zone, how long until something) a screen of its own with a check by the one chosen; text
// as inline fields or a screen of its own with Done; destructive actions as red rows confirmed by an action
// sheet. A section's deeper screens (a choice, an edit, Change password) are pushed onto the Settings tab's
// own stack as `?screen=<id>` on the section's address, so Back, the edge swipe and the collapsing title
// work as for any screen; the section stays mounted (hidden) under them, so its state (a draft, a choice
// half made) and handlers carry on from one of its screens to the next.

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { haptic } from "@/lib/nativeApp";
import { confirmAction, hasNative } from "@/lib/native/ui";
import { GlassTextButton } from "./Glass";

export const SCREEN_PARAM = "screen";

interface ScreenChrome {
  title: string;
  /** The screen that set it (so one going away doesn't clear the next one's). */
  owner: string;
}

interface SettingsScreens {
  /** The pushed screen on show (`?screen=`), or null for the section itself. */
  screen: string | null;
  /** Where the pushed screen draws (a Subscreen's content goes here), and its bar's actions (Done). */
  slot: HTMLElement | null;
  actions: HTMLElement | null;
  setChrome: React.Dispatch<React.SetStateAction<ScreenChrome | null>>;
  open: (screen: string) => void;
  back: () => void;
}

const ScreensContext = createContext<SettingsScreens | null>(null);

/** The pushed screens of the Settings section on show (null outside the iPhone Settings). */
export function useSettingsScreens(): SettingsScreens | null {
  return useContext(ScreensContext);
}

/**
 * Holds a Settings section and its pushed screens: the section, hidden while one of its screens is on show,
 * and the slot that screen draws into. `render` gets the chrome a screen asked for (its title, a Done).
 */
export function SettingsScreensHost({ children, render }: { children: ReactNode; render: (screen: { active: boolean; chrome: ScreenChrome | null; slot: (el: HTMLElement | null) => void; actions: (el: HTMLElement | null) => void }) => ReactNode }) {
  const { pathname, search, navigate, back: goBack, canBack } = useAppRouter();
  const screen = search.get(SCREEN_PARAM);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [chrome, setChrome] = useState<ScreenChrome | null>(null);
  const open = useCallback((id: string) => navigate(`${pathname}?${SCREEN_PARAM}=${encodeURIComponent(id)}`), [navigate, pathname]);
  const back = useCallback(() => {
    if (canBack) goBack();
    else navigate(pathname, { replace: true });
  }, [canBack, goBack, navigate, pathname]);
  const value = { screen, slot, actions, setChrome, open, back };
  return (
    <ScreensContext.Provider value={value}>
      {render({ active: screen !== null, chrome, slot: setSlot, actions: setActions })}
      {/* The section itself: on show, or mounted under its pushed screen (its rows and handlers carry on). */}
      <div className={screen !== null ? "hidden" : "flex min-h-0 flex-1 flex-col"}>{children}</div>
    </ScreensContext.Provider>
  );
}

/** A screen pushed from a section (a choice, an edit, a group of settings): drawn only while it's on show. */
export function Subscreen({ id, title, trailing, children }: { id: string; title: string; trailing?: ReactNode; children: ReactNode }) {
  const screens = useSettingsScreens();
  const active = screens?.screen === id;
  // A deeper screen pushed from this one: this one stays mounted (hidden) so that one can draw.
  const under = Boolean(screens?.screen?.startsWith(`${id}.`));
  const setChrome = screens?.setChrome;
  useLayoutEffect(() => {
    if (!active || !setChrome) return;
    setChrome((prev: ScreenChrome | null) => (prev?.title === title && prev.owner === id ? prev : { title, owner: id }));
  }, [active, setChrome, title, id]);
  useEffect(() => {
    if (!active || !setChrome) return;
    return () => setChrome((prev) => (prev?.owner === id ? null : prev));
  }, [active, setChrome, id]);
  if (!screens) return null;
  if (active && screens.slot)
    return (
      <>
        {createPortal(<div className="space-y-7 pb-4 pt-3">{children}</div>, screens.slot)}
        {trailing && screens.actions ? createPortal(trailing, screens.actions) : null}
      </>
    );
  if (under) return <div hidden>{children}</div>;
  return null;
}

/** A group's heading: 13/18 semibold capitals (docs/IOS_POLISH_PLAN.md §2.2 "caption caps"), the same on every screen. */
export const GROUP_HEADER = "px-4 pb-2 text-[13px] font-semibold uppercase leading-[18px] tracking-[0.04em] text-muted";
/** The explanation under a group: 13/18, muted, 8 below it. */
export const GROUP_FOOTER = "px-4 pt-2 text-[13px] leading-[18px] text-muted [&_a]:underline [&_a]:underline-offset-2";

/** A section of an inset grouped list: a short heading in capitals, rounded rows, an explanation under it. */
export function IosSection({ header, footer, children, label, role, data }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; /** The section's name for VoiceOver when it has no heading. */ label?: string; /** The rows' own role (a radio group of choices). */ role?: string; /** data-* attributes for the rows' box (a test id, a state). */ data?: Record<`data-${string}`, string> }) {
  const id = useId();
  return (
    <section className="px-4" aria-labelledby={header ? id : undefined} aria-label={header ? undefined : label}>
      {header ? (
        <h3 id={id} className={GROUP_HEADER}>
          {header}
        </h3>
      ) : null}
      <div className="ui-grouped" role={role} aria-label={role ? label : undefined} {...data}>
        {children}
      </div>
      {footer ? <div className={GROUP_FOOTER}>{footer}</div> : null}
    </section>
  );
}

/** A one-line row is 52 tall, two lines 64 (§2.1); the text sets the height, so Dynamic Type grows it. */
const ROW = "relative flex min-h-[52px] w-full items-center gap-3 px-4 text-left outline-none transition-colors focus-visible:bg-[var(--liquid-active)] disabled:opacity-40";
const PRESS = "active:bg-[var(--liquid-press)]";
/** Where the hairline above a row starts: past its icon (16 + 30 + 12), else at the text. */
const insetFor = (icon: boolean) => ({ ["--sep-inset" as string]: icon ? "58px" : "16px" }) as React.CSSProperties;

/**
 * A row: an icon, a label (with a quieter line under it), a value, something at the end (a switch, a
 * badge), then a check or a chevron. A button with `onClick`, a pushed screen with `screen`, else plain.
 */
export function IosRow({
  icon,
  label,
  description,
  value,
  trailing,
  onClick,
  screen,
  chevron,
  checked,
  danger,
  disabled,
  ariaLabel,
  center,
  href,
  current,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  /** Opens this pushed screen (a Subscreen's id). */
  screen?: string;
  chevron?: boolean;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  /** A button row whose label sits in the middle (Sign out). */
  center?: boolean;
  /** Opens another page of the app (a link row, with a chevron). */
  href?: string;
  /** The page on show (the iPad's Settings list beside its section): filled, no chevron. */
  current?: boolean;
}) {
  const screens = useSettingsScreens();
  const opens = screen ? () => screens?.open(screen) : onClick;
  const body = (
    <>
      {icon}
      <span className={`min-w-0 flex-1 ${description ? "py-[11px]" : "py-[15px]"} ${center ? "text-center" : ""}`}>
        <span className={`block text-[17px] leading-[22px] [overflow-wrap:anywhere] ${danger ? "text-danger" : opens && !screen && !chevron && checked === undefined && !trailing && value === undefined ? "font-medium text-heading" : "text-ink"}`}>{label}</span>
        {description ? <span className="mt-0.5 block text-[15px] leading-[20px] text-muted [overflow-wrap:anywhere]">{description}</span> : null}
      </span>
      {value !== undefined && value !== null ? <span className="max-w-[55%] flex-none truncate text-right text-[17px] leading-[22px] text-muted">{value}</span> : null}
      {trailing}
      {checked ? <Check size={20} strokeWidth={2.4} aria-hidden className="flex-none text-heading" /> : checked === false ? <span aria-hidden className="w-5 flex-none" /> : null}
      {(chevron ?? Boolean(screen || (href && !current))) ? <ChevronRight size={18} strokeWidth={2.2} aria-hidden className="-mr-1 flex-none text-faint" /> : null}
    </>
  );
  const style = insetFor(Boolean(icon));
  if (href)
    return (
      <AppLink href={href} onClick={onClick} aria-label={ariaLabel} aria-current={current ? "page" : undefined} className={`${ROW} ${PRESS} ${current ? "bg-[color-mix(in_oklab,var(--color-heading)_9%,transparent)]" : ""}`} style={style}>
        {body}
      </AppLink>
    );
  if (opens)
    return (
      <button type="button" onClick={opens} disabled={disabled} aria-label={ariaLabel} aria-pressed={checked === undefined ? undefined : checked} className={`${ROW} ${PRESS}`} style={style}>
        {body}
      </button>
    );
  return (
    <div className={ROW} style={style} aria-label={ariaLabel}>
      {body}
    </div>
  );
}

/** iOS's on/off switch, in the app's neutral colours (dark when on, light in dark mode). */
export function IosSwitch({ checked, onChange, label, describedBy, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; describedBy?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => {
        haptic("light");
        onChange(!checked);
      }}
      className={`relative inline-flex h-[31px] w-[51px] flex-none items-center rounded-capsule outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40 ${checked ? "bg-heading" : "bg-[color-mix(in_oklab,var(--color-ink)_16%,transparent)]"}`}
    >
      <span
        aria-hidden
        className={`inline-block h-[27px] w-[27px] rounded-capsule shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-[transform,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${checked ? "translate-x-[22px] bg-canvas" : "translate-x-[2px] bg-white"}`}
      />
    </button>
  );
}

/** A row with a switch at its end. */
export function SwitchRow({ icon, label, description, checked, onChange, disabled }: { icon?: ReactNode; label: string; description?: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const descId = useId();
  return (
    <IosRow
      icon={icon}
      label={label}
      description={description ? <span id={descId}>{description}</span> : undefined}
      trailing={<IosSwitch checked={checked} onChange={onChange} label={label} describedBy={description ? descId : undefined} disabled={disabled} />}
    />
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
}

/**
 * A setting with a few (or many) choices: a row with the one chosen, which pushes a screen listing them with
 * a check by the chosen one (a light tap when another is picked). The screen stays until Back, as in iOS
 * Settings. `filter` adds a search field (time zones).
 */
export function ChoiceRow<T extends string>({
  screen,
  label,
  icon,
  value,
  choices,
  onChange,
  header,
  footer,
  disabled,
  filter,
  valueLabel,
}: {
  screen: string;
  label: string;
  icon?: ReactNode;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (next: T) => void;
  header?: ReactNode;
  footer?: ReactNode;
  disabled?: boolean;
  filter?: boolean;
  /** What the row shows for the chosen one (defaults to its label). */
  valueLabel?: string;
}) {
  const chosen = choices.find((c) => c.value === value);
  return (
    <>
      <IosRow icon={icon} label={label} value={valueLabel ?? chosen?.label ?? ""} screen={screen} disabled={disabled} ariaLabel={`${label}: ${valueLabel ?? chosen?.label ?? ""}`} />
      <Subscreen id={screen} title={label}>
        <ChoiceList label={label} value={value} choices={choices} onChange={onChange} header={header} footer={footer} filter={filter} />
      </Subscreen>
    </>
  );
}

function ChoiceList<T extends string>({ label, value, choices, onChange, header, footer, filter }: { label: string; value: T; choices: readonly Choice<T>[]; onChange: (next: T) => void; header?: ReactNode; footer?: ReactNode; filter?: boolean }) {
  const [q, setQ] = useState("");
  const shown = q.trim() ? choices.filter((c) => c.label.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())) : choices;
  return (
    <>
      {filter ? (
        <div className="px-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label={`Search ${label.toLowerCase()}`}
            className="h-10 w-full rounded-control bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] px-3 text-[17px] text-ink outline-none placeholder:text-faint"
          />
        </div>
      ) : null}
      <IosSection header={header} footer={footer} label={label} role="radiogroup">
        {shown.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={c.value === value}
              onClick={() => {
                if (c.value !== value) haptic("light");
                onChange(c.value);
              }}
              className={`${ROW} ${PRESS}`}
              style={insetFor(Boolean(c.icon))}
            >
              {c.icon}
              <span className={`min-w-0 flex-1 ${c.description ? "py-[11px]" : "py-[15px]"}`}>
                <span className="block text-[17px] leading-[22px] text-ink [overflow-wrap:anywhere]">{c.label}</span>
                {c.description ? <span className="mt-0.5 block text-[15px] leading-[20px] text-muted">{c.description}</span> : null}
              </span>
              {c.value === value ? <Check size={20} strokeWidth={2.4} aria-hidden className="flex-none text-heading" /> : null}
            </button>
          ))}
          {!shown.length ? <p className="px-4 py-3 text-[15px] text-muted">No matches</p> : null}
      </IosSection>
    </>
  );
}

/** A text field inside a row: its label at the start, the field filling the rest (iOS's "Name   Ada"). */
export function TextRow({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
  readOnly,
  maxLength,
  stacked,
  describedBy,
}: {
  label: string;
  value: string;
  onChange?: (next: string) => void;
  /** Called when the field is left or Return is pressed. */
  onCommit?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "password" | "url" | "number" | "search";
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  readOnly?: boolean;
  maxLength?: number;
  /** The label above the field (long values, passwords). */
  stacked?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`relative flex min-h-[52px] w-full px-4 ${stacked ? "flex-col justify-center gap-0.5 py-2" : "items-center gap-3"}`} style={insetFor(false)}>
      <span className={`flex-none ${stacked ? "text-[13px] text-muted" : "text-[17px] text-ink"}`}>{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-describedby={describedBy}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onCommit) {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-faint ${stacked ? "py-0.5" : "py-[15px] text-right"} ${readOnly ? "text-muted" : "text-ink"}`}
      />
    </label>
  );
}

/**
 * A value edited on a screen of its own (a longer text), with Cancel and Done: the row shows the value, the
 * screen has the field, Done saves and goes back.
 */
export function EditRow({ screen, label, value, onSave, placeholder, multiline, footer, maxLength, icon }: { screen: string; label: string; value: string; onSave: (next: string) => Promise<unknown> | void; placeholder?: string; multiline?: boolean; footer?: ReactNode; maxLength?: number; icon?: ReactNode }) {
  return (
    <>
      <IosRow icon={icon} label={label} value={value || placeholder} screen={screen} ariaLabel={`${label}: ${value || "not set"}`} />
      <EditScreen screen={screen} label={label} value={value} onSave={onSave} placeholder={placeholder} multiline={multiline} footer={footer} maxLength={maxLength} />
    </>
  );
}

export function EditScreen({ screen, label, value, onSave, placeholder, multiline, footer, maxLength }: { screen: string; label: string; value: string; onSave: (next: string) => Promise<unknown> | void; placeholder?: string; multiline?: boolean; footer?: ReactNode; maxLength?: number }) {
  const screens = useSettingsScreens();
  const [draft, setDraft] = useState(value);
  const active = screens?.screen === screen;
  const shownFor = useRef(false);
  // Each visit starts from the saved value.
  useEffect(() => {
    if (active && !shownFor.current) setDraft(value);
    shownFor.current = active;
  }, [active, value]);
  const done = async () => {
    await onSave(draft);
    screens?.back();
  };
  return (
    <Subscreen id={screen} title={label} trailing={<GlassTextButton strong onClick={() => void done()}>Done</GlassTextButton>}>
      <IosSection footer={footer} label={label}>
        {multiline ? (
          <textarea
            autoFocus
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={label}
            onChange={(e) => setDraft(e.target.value)}
            className="block min-h-36 w-full resize-none bg-transparent px-4 py-3 text-[17px] leading-snug text-ink outline-none placeholder:text-faint"
          />
        ) : (
          <input
            autoFocus
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={label}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void done();
              }
            }}
            className="block h-[52px] w-full bg-transparent px-4 text-[17px] text-ink outline-none placeholder:text-faint"
          />
        )}
      </IosSection>
    </Subscreen>
  );
}

export interface SheetAction {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * iOS's action sheet: a title and message, the actions on glass at the bottom of the screen, and Cancel on its
 * own below them. Escape, a tap outside or Cancel close it; a destructive one is felt (warning).
 */
export function ActionSheet({ open, onClose, title, message, actions }: { open: boolean; onClose: () => void; title?: string; message?: ReactNode; actions: SheetAction[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const msgId = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const btn = "flex min-h-[56px] w-full items-center justify-center px-4 text-[19px] outline-none transition-colors active:bg-[var(--liquid-press)] focus-visible:bg-[var(--liquid-active)]";
  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={message ? msgId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 h-auto max-h-none w-full max-w-none border-0 bg-transparent px-2 pb-[max(8px,env(safe-area-inset-bottom))] text-ink outline-none backdrop:bg-[var(--iphone-scrim)] backdrop:animate-[iphone-fade-in_200ms_ease-out] [@media(orientation:landscape)]:mx-auto [@media(orientation:landscape)]:max-w-[420px]"
    >
      {open ? (
        <div className="animate-[iphone-sheet-in_320ms_cubic-bezier(0.32,0.72,0,1)] space-y-2 motion-reduce:animate-none">
          <div className="ui-liquid-strong overflow-hidden rounded-sheet">
            {title || message ? (
              <div className="px-5 pb-3.5 pt-4 text-center">
                {title ? (
                  <h2 id={titleId} className="text-[13px] font-semibold text-muted">
                    {title}
                  </h2>
                ) : null}
                {message ? (
                  <div id={msgId} className="mt-1 text-[13px] leading-snug text-muted">
                    {message}
                  </div>
                ) : null}
              </div>
            ) : null}
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  if (a.danger) haptic("warning");
                  onClose();
                  a.onSelect();
                }}
                className={`${btn} shadow-[inset_0_0.5px_0_var(--iphone-separator)] ${a.danger ? "text-danger" : "text-heading"}`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="ui-liquid-strong overflow-hidden rounded-sheet">
            <button type="button" autoFocus onClick={onClose} className={`${btn} font-semibold text-heading`}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * A red row for something that can't be undone (Sign out everywhere, Delete): it asks first in an action
 * sheet, whose red button does it.
 */
export function DestructiveRow({ label, confirm, message, onConfirm, disabled, icon }: { label: string; /** The action sheet's red button (defaults to the row's label). */ confirm?: string; message?: ReactNode; onConfirm: () => void; disabled?: boolean; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  // In the apps, iOS's own action sheet (from the row on an iPad); elsewhere the one drawn here.
  const ask = () => {
    if (!hasNative("actionSheet")) return setOpen(true);
    const row = host.current?.previousElementSibling ?? null;
    void confirmAction({ title: typeof message === "string" ? message : label, confirm: confirm ?? label, destructive: true, style: "sheet", anchor: row }).then((yes) => yes && onConfirm());
  };
  return (
    <>
      <IosRow icon={icon} label={label} danger disabled={disabled} onClick={ask} />
      <div ref={host} hidden />
      <ActionSheet open={open} onClose={() => setOpen(false)} message={message} actions={[{ label: confirm ?? label, danger: true, onSelect: onConfirm }]} />
    </>
  );
}

/** A row that's a plain action (Upload a picture, Add a passkey): its label in the heading colour. */
export function ActionRow({ label, onClick, disabled, icon, busy }: { label: string; onClick: () => void; disabled?: boolean; icon?: ReactNode; busy?: string | null }) {
  return <IosRow icon={icon} label={busy ?? label} onClick={onClick} disabled={disabled || Boolean(busy)} />;
}

/** Plain text inside a grouped section (an explanation, a status) with a row's padding. */
export function IosText({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <div className={`relative px-4 py-3 text-[15px] leading-snug ${muted ? "text-muted" : "text-ink"}`} style={insetFor(false)}>{children}</div>;
}

/** The last thing on the root Settings screen: which Folevi this is (its version and build), centred and quiet. */
export function VersionFooter({ version, build }: { version?: string | null; build?: string | null }) {
  if (!version) return null;
  return (
    <p className="px-8 pb-2 pt-1 text-center text-[13px] leading-[18px] text-muted" data-testid="settings-version">
      Folevi {version}
      {build ? ` (${build})` : ""}
    </p>
  );
}
