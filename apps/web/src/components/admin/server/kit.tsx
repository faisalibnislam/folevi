"use client";

// Shared pieces of Folevi Server's admin panel (docs/SELF_HOSTING_PLAN.md §6): the settings from Convex
// (serverAdmin:getSettings / updateSettings, CONTRACT §8) and folevid's state through /api/server/* (§5).
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { useQueryState } from "@/lib/convex/queries";
import { serverAdminRefs, type ServerSettings, type ServerSettingsPatch } from "@/lib/server-edition/refs";
import { Button } from "@/components/ui/Button";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { Switch } from "@/components/ui/Switch";
import { ErrorNotice, inputCls } from "../ui";

// ---------------------------------------------------------------- folevid through /api/server

export class ControlError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One call to folevid through the web server (which checks the role and holds the secret). */
export async function control<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/server/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message = (json as { error?: { message?: string } | string } | null)?.error;
    throw new ControlError(typeof message === "string" ? message : (message?.message ?? "The server's supervisor didn't answer."), res.status);
  }
  return json as T;
}

/** A folevid read, loaded on mount and again with `reload()` (or every `everyMs`). */
export function useControl<T>(path: string | null, everyMs?: number): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: path !== null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    control<T>("GET", path).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error: unknown) => live && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      live = false;
    };
  }, [path, tick]);
  useEffect(() => {
    if (!everyMs || path === null) return;
    const id = window.setInterval(reload, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs, path, reload]);
  return { ...state, reload };
}

export function controlMessage(error: unknown): string {
  return error instanceof ControlError ? error.message : errorMessage(error);
}

// ---------------------------------------------------------------- settings

export type SaveSettings = (patch: ServerSettingsPatch, done?: string) => Promise<boolean>;

export function useServerSettings(): { settings: ServerSettings | undefined; error: unknown; save: SaveSettings } {
  const state = useQueryState(serverAdminRefs.getSettings, {});
  const update = useMutation(serverAdminRefs.updateSettings);
  const toast = useToast();
  const save = useCallback(
    async (patch: ServerSettingsPatch, done = "Saved.") => {
      try {
        await update(patch);
        toast.show(done, { tone: "success" });
        return true;
      } catch (e) {
        toast.show(errorMessage(e), { tone: "error" });
        return false;
      }
    },
    [toast, update],
  );
  return { settings: state.data as ServerSettings | undefined, error: state.error, save };
}

/** The settings, or a loading line, or the error with a retry. */
export function WithSettings({ children }: { children: (settings: ServerSettings, save: SaveSettings) => ReactNode }) {
  const { settings, error, save } = useServerSettings();
  if (error && !settings) return <ErrorNotice error={error} />;
  if (!settings) return <Loading />;
  return <>{children(settings, save)}</>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="py-6 text-subheadline text-muted" aria-busy="true">
      {label}
    </p>
  );
}

// ---------------------------------------------------------------- form rows

/** A labelled row: the words on the left, the control on the right (stacked on a phone). */
export function SettingRow({ label, description, children, htmlFor }: { label: string; description?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line py-3.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-body font-medium text-heading">
            {label}
          </label>
        ) : (
          <p className="text-body font-medium text-heading">{label}</p>
        )}
        {description ? <div className="mt-0.5 text-subheadline text-muted">{description}</div> : null}
      </div>
      <div className="flex flex-none items-center gap-2 sm:max-w-[60%]">{children}</div>
    </div>
  );
}

/** A switch that saves at once. */
export function SwitchRow({ label, description, checked, onChange, disabled }: { label: string; description?: ReactNode; checked: boolean; onChange: (next: boolean) => void | Promise<unknown>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const descId = useId();
  return (
    <SettingRow label={label} description={description ? <span id={descId}>{description}</span> : undefined}>
      <Switch
        checked={checked}
        label={label}
        describedBy={description ? descId : undefined}
        disabled={disabled || busy}
        onChange={(next) => {
          setBusy(true);
          void Promise.resolve(onChange(next)).finally(() => setBusy(false));
        }}
      />
    </SettingRow>
  );
}

/** A text field. */
export function TextInput({ id, value, onChange, placeholder, type = "text", autoComplete = "off", className, ...rest }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoComplete?: string; className?: string; "aria-label"?: string; inputMode?: "text" | "numeric" | "email" | "url" }) {
  return <input id={id} type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} spellCheck={false} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${className ?? ""}`} {...rest} />;
}

/** A secret the backend never sends back: shows whether one is stored, and takes a new one. */
export function SecretInput({ id, set, value, onChange, label }: { id?: string; set: boolean | undefined; value: string; onChange: (v: string) => void; label: string }) {
  return <TextInput id={id} type="password" value={value} onChange={onChange} aria-label={label} autoComplete="new-password" placeholder={set ? "Saved. Type to replace it" : "Not set"} />;
}

/** The form's Save button, on when something changed. */
export function SaveBar({ dirty, busy, onSave, onReset, label = "Save changes" }: { dirty: boolean; busy: boolean; onSave: () => void; onReset?: () => void; label?: string }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      {onReset && dirty ? (
        <Button variant="quiet" onClick={onReset} disabled={busy}>
          Undo changes
        </Button>
      ) : null}
      <Button variant="primary" onClick={onSave} disabled={!dirty || busy} aria-busy={busy}>
        {busy ? "Saving…" : label}
      </Button>
    </div>
  );
}

/** A form's draft of some settings: edits, whether they differ, and save. */
export function useDraft<T>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const base = useRef(JSON.stringify(initial));
  const key = JSON.stringify(initial);
  useEffect(() => {
    if (key !== base.current) {
      base.current = key;
      setDraft(JSON.parse(key) as T);
    }
  }, [key]);
  const dirty = JSON.stringify(draft) !== base.current;
  const set = <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return { draft, setDraft, set, dirty, reset: () => setDraft(JSON.parse(base.current) as T) };
}

export function bytesToGb(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? "" : String(Math.round((bytes / 1024 ** 3) * 100) / 100);
}

export function gbToBytes(text: string): number | null {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1024 ** 3) : null;
}

export function durationText(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}
