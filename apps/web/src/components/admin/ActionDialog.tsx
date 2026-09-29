"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { requestMeta } from "./request";
import { inputCls, selectCls } from "./ui";
import { Select } from "@/components/ui/Select";

export const REASON_MIN = 8;
export const REASON_MAX = 500;

export interface FieldSpec {
  name: string;
  label: string;
  type: "number" | "text" | "select" | "textarea";
  initial: string;
  hint?: ReactNode;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number | "any";
  maxLength?: number;
  suffix?: string;
  validate?: (value: string) => string | null;
}

export interface SubmitContext {
  reason: string;
  fields: Record<string, string>;
  confirmValue: string;
  meta: { requestId: string; clientHash?: string };
}

/**
 * Every sensitive admin action goes through this dialog: a written reason (kept in the audit log),
 * optional typed confirmation, optional acknowledgement checkbox and optional extra fields. Errors
 * are tied to their inputs; server errors are shown inline and the dialog stays open.
 */
export function ActionDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = "primary",
  fields = [],
  confirm,
  acknowledge,
  children,
  confirmDisabled,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  fields?: FieldSpec[];
  /** Typed confirmation, e.g. the user's email or the workspace name. */
  confirm?: { label: ReactNode; expected: string; caseInsensitive?: boolean };
  acknowledge?: string;
  children?: ReactNode;
  /** Keeps the confirm button off (e.g. nothing would change yet). */
  confirmDisabled?: boolean;
  /** Performs the action; resolves to the success message shown in a toast. */
  onSubmit: (ctx: SubmitContext) => Promise<string>;
}) {
  const toast = useToast();
  const uid = useId();
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmValue, setConfirmValue] = useState("");
  const [ack, setAck] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setValues(Object.fromEntries(fields.map((f) => [f.name, f.initial])));
    setConfirmValue("");
    setAck(false);
    setErrors({});
    setFormError(null);
    setBusy(false);
    // Reset only when the dialog opens; field specs are recreated on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.name] ?? "";
      if (f.type === "number") {
        const n = Number(v);
        if (v.trim() === "" || !Number.isFinite(n)) next[f.name] = `Enter a number for ${f.label.toLowerCase()}.`;
        else if (f.min !== undefined && n < f.min) next[f.name] = `Must be at least ${f.min}${f.suffix ? ` ${f.suffix}` : ""}.`;
        else if (f.max !== undefined && n > f.max) next[f.name] = `Must be at most ${f.max}${f.suffix ? ` ${f.suffix}` : ""}.`;
      }
      const custom = !next[f.name] && f.validate ? f.validate(v) : null;
      if (custom) next[f.name] = custom;
    }
    if (confirm) {
      const typed = confirm.caseInsensitive ? confirmValue.trim().toLowerCase() : confirmValue.trim();
      const expected = confirm.caseInsensitive ? confirm.expected.trim().toLowerCase() : confirm.expected.trim();
      if (typed !== expected) next.confirm = typed ? "That doesn't match. Type it exactly as shown." : "Type it exactly as shown to confirm.";
    }
    if (acknowledge && !ack) next.ack = "Tick this box to confirm the user asked for it.";
    if (reason.trim().length < REASON_MIN) next.reason = `Give a reason of at least ${REASON_MIN} characters. It is kept in the audit log.`;
    return next;
  };

  const submit = async () => {
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      const first = ["confirm", "ack", ...fields.map((f) => f.name), "reason"].find((k) => found[k]);
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const meta = await requestMeta();
      const message = await onSubmit({ reason: reason.trim(), fields: values, confirmValue: confirmValue.trim(), meta });
      toast.show(message, { tone: "success" });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const describedBy = (key: string, hasHint: boolean) => [hasHint ? `${uid}-${key}-hint` : null, errors[key] ? `${uid}-${key}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={`${uid}-form`} variant={tone === "danger" ? "danger" : "primary"} disabled={busy || confirmDisabled} aria-busy={busy || undefined}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id={`${uid}-form`}
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {children}
        {fields.map((f) => {
          const id = `${uid}-${f.name}`;
          const common = {
            id,
            name: f.name,
            value: values[f.name] ?? "",
            "aria-invalid": errors[f.name] ? true : undefined,
            "aria-describedby": describedBy(f.name, Boolean(f.hint)),
          } as const;
          return (
            <div key={f.name} className="text-sm">
              <label htmlFor={id} className="mb-1 block font-medium">
                {f.label}
              </label>
              {f.type === "select" ? (
                <Select {...common} className={selectCls} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : f.type === "textarea" ? (
                <textarea
                  {...common}
                  rows={3}
                  maxLength={f.maxLength}
                  className={`${inputCls} h-auto py-2`}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    {...common}
                    type={f.type === "number" ? "number" : "text"}
                    inputMode={f.type === "number" ? "decimal" : undefined}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    maxLength={f.maxLength}
                    autoComplete="off"
                    className={`${inputCls} ${f.type === "number" ? "max-w-[180px] tabular-nums" : ""}`}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                  {f.suffix ? <span className="text-muted">{f.suffix}</span> : null}
                </div>
              )}
              {f.hint ? (
                <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
                  {f.hint}
                </p>
              ) : null}
              {errors[f.name] ? (
                <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
                  {errors[f.name]}
                </p>
              ) : null}
            </div>
          );
        })}
        {confirm ? (
          <div className="text-sm">
            <label htmlFor={`${uid}-confirm`} className="mb-1 block">
              {confirm.label}
            </label>
            <input
              id={`${uid}-confirm`}
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.confirm ? true : undefined}
              aria-describedby={describedBy("confirm", false)}
              className={inputCls}
            />
            {errors.confirm ? (
              <p id={`${uid}-confirm-error`} className="mt-1 text-xs font-medium text-danger">
                {errors.confirm}
              </p>
            ) : null}
          </div>
        ) : null}
        {acknowledge ? (
          <div className="text-sm">
            <label className="flex items-start gap-2.5">
              <input
                id={`${uid}-ack`}
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                aria-invalid={errors.ack ? true : undefined}
                aria-describedby={describedBy("ack", false)}
                className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-heading)]"
              />
              <span>{acknowledge}</span>
            </label>
            {errors.ack ? (
              <p id={`${uid}-ack-error`} className="mt-1 text-xs font-medium text-danger">
                {errors.ack}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="text-sm">
          <label htmlFor={`${uid}-reason`} className="mb-1 block font-medium">
            Reason
          </label>
          <textarea
            id={`${uid}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={REASON_MAX}
            required
            aria-required="true"
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={describedBy("reason", true)}
            placeholder="e.g. Ticket #4821: user reported a lost device"
            className={`${inputCls} h-auto py-2`}
          />
          <p id={`${uid}-reason-hint`} className="mt-1 text-xs text-muted">
            Required, at least {REASON_MIN} characters. Stored permanently with this action in the audit log.
          </p>
          {errors.reason ? (
            <p id={`${uid}-reason-error`} className="mt-1 text-xs font-medium text-danger">
              {errors.reason}
            </p>
          ) : null}
        </div>
        {formError ? (
          <div role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px]">
            {formError}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
