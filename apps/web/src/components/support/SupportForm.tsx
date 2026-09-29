"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { FORM_TOPICS, SECURITY_MAILBOX, SUPPORT_LIMITS, SUPPORT_MAILBOX, TOPIC_LABELS } from "@/lib/support";

type Topic = (typeof FORM_TOPICS)[number];
type FieldName = "name" | "email" | "topic" | "message";

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

export interface SupportAccount {
  name: string;
  email: string;
}

function validate(values: { name: string; email: string; topic: string; message: string }, account: SupportAccount | null): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  if (!values.name.trim()) errors.name = "Enter your name.";
  else if (values.name.trim().length > SUPPORT_LIMITS.name) errors.name = `Keep your name under ${SUPPORT_LIMITS.name} characters.`;
  if (!account && !EMAIL_RE.test(values.email.trim())) errors.email = "Enter an email address we can reply to.";
  if (!(FORM_TOPICS as readonly string[]).includes(values.topic)) errors.topic = "Choose a topic.";
  const message = values.message.trim();
  if (message.length < SUPPORT_LIMITS.messageMin) errors.message = "Tell us a little more (at least a sentence).";
  else if (message.length > SUPPORT_LIMITS.message) errors.message = `Keep your message under ${SUPPORT_LIMITS.message} characters.`;
  return errors;
}

/**
 * The support request form, on the support page (`variant="site"`) and in the app's Contact support dialog
 * (`variant="app"`). It posts to /api/support; signed in, the server files the request under the account
 * from the session (the email field is shown locked, for reference only).
 */
export function SupportForm({
  variant,
  account = null,
  initialTopic = "other",
  onCancel,
  onSent,
}: {
  variant: "site" | "app";
  account?: SupportAccount | null;
  initialTopic?: Topic;
  onCancel?: () => void;
  onSent?: (number: number | null) => void;
}) {
  const uid = useId();
  const [name, setName] = useState(account?.name ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [topic, setTopic] = useState<string>(initialTopic);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ number: number | null; email: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const id = (f: string) => `${uid}-${f}`;
  const describedBy = (f: FieldName, hint?: string) => [errors[f] ? id(`${f}-error`) : null, hint ?? null].filter(Boolean).join(" ") || undefined;

  const submit = async () => {
    const found = validate({ name, email, topic, message }, account);
    setErrors(found);
    setFormError(null);
    const first = (["name", "email", "topic", "message"] as FieldName[]).find((f) => found[f]);
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id(first))}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email: account ? undefined : email, topic, message, website, source: variant === "app" ? "in_app" : "web_form" }),
      });
      const data = (await res.json().catch(() => null)) as { number?: number | null; error?: { message?: string; field?: string | null } } | null;
      if (!res.ok) {
        const field = data?.error?.field as FieldName | null | undefined;
        const text = data?.error?.message ?? "Your request couldn't be sent. Try again.";
        if (field && ["name", "email", "topic", "message"].includes(field)) setErrors({ [field]: text });
        else setFormError(text);
        return;
      }
      const number = typeof data?.number === "number" ? data.number : null;
      setSent({ number, email: account?.email ?? email.trim() });
      onSent?.(number);
    } catch {
      setFormError(`Your request couldn't be sent. Check your connection and try again, or email ${SUPPORT_MAILBOX}.`);
    } finally {
      setBusy(false);
    }
  };

  const site = variant === "site";
  const input = `ui-input w-full rounded-[6px] px-3 text-ink placeholder:text-faint aria-[invalid=true]:shadow-[0_0_0_1.5px_var(--color-destructive)] ${site ? "h-11 text-[15px]" : "h-9 text-sm"}`;
  const label = site ? "mb-1.5 block text-[14px] font-medium text-(--color-heading)" : "mb-1 block text-sm font-medium text-heading";
  const hint = site ? "mt-1.5 text-[13px] text-muted" : "mt-1 text-[12.5px] text-muted";
  const errorCls = site ? "mt-1.5 text-[13px] text-danger" : "mt-1 text-[12.5px] text-danger";

  if (sent) {
    return (
      <div role="status" aria-live="polite" className={site ? "py-2" : ""}>
        <p className={site ? "text-[18px] font-semibold text-(--color-heading)" : "text-[15px] font-semibold text-heading"}>
          {sent.number ? `We got your message. Your request number is #${sent.number}.` : "We got your message."}
        </p>
        <p className={site ? "mt-2 text-[15px] leading-relaxed text-muted" : "mt-1.5 text-sm text-muted"}>
          We sent a confirmation to <span className="font-medium text-ink">{sent.email}</span> and will reply there. To add details, reply to that email.
          {account ? " Replies also appear in Help, under Your support requests." : ""}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {site ? (
            <button
              type="button"
              className="mk-btn mk-btn-secondary h-10 px-4 text-[14px]"
              onClick={() => {
                setSent(null);
                setMessage("");
              }}
            >
              Send another request
            </button>
          ) : (
            <Button variant="primary" onClick={onCancel}>
              Done
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      noValidate
      aria-label="Contact support"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void submit();
      }}
      className={site ? "space-y-5" : "space-y-4"}
    >
      <div className={site ? "grid gap-5 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2"}>
        <div>
          <label htmlFor={id("name")} className={label}>
            Your name
          </label>
          <input
            id={id("name")}
            name="name"
            autoComplete="name"
            value={name}
            maxLength={SUPPORT_LIMITS.name + 20}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((x) => ({ ...x, name: undefined }));
            }}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy("name")}
            className={input}
          />
          {errors.name ? (
            <p id={id("name-error")} className={errorCls}>
              {errors.name}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={id("email")} className={label}>
            Email
          </label>
          <input
            id={id("email")}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            readOnly={Boolean(account)}
            maxLength={254}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((x) => ({ ...x, email: undefined }));
            }}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy("email", account ? id("email-hint") : undefined)}
            className={`${input} ${account ? "cursor-default bg-[var(--glass-hover)] text-muted" : ""}`}
          />
          {account ? (
            <p id={id("email-hint")} className={hint}>
              Your account&apos;s address. We reply there.
            </p>
          ) : null}
          {errors.email ? (
            <p id={id("email-error")} className={errorCls}>
              {errors.email}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <label id={id("topic-label")} htmlFor={id("topic")} className={label}>
          Topic
        </label>
        <Select
          id={id("topic")}
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value);
            setErrors((x) => ({ ...x, topic: undefined }));
          }}
          aria-labelledby={id("topic-label")}
          aria-invalid={errors.topic ? true : undefined}
          aria-describedby={describedBy("topic")}
          className={`${input} pr-2.5`}
        >
          {FORM_TOPICS.map((t) => (
            <option key={t} value={t}>
              {TOPIC_LABELS[t]}
            </option>
          ))}
        </Select>
        {errors.topic ? (
          <p id={id("topic-error")} className={errorCls}>
            {errors.topic}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor={id("message")} className={label}>
          Message
        </label>
        <textarea
          id={id("message")}
          name="message"
          value={message}
          rows={site ? 7 : 6}
          maxLength={SUPPORT_LIMITS.message + 200}
          onChange={(e) => {
            setMessage(e.target.value);
            setErrors((x) => ({ ...x, message: undefined }));
          }}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={describedBy("message", id("message-hint"))}
          className={`${input} h-auto resize-y py-2.5 leading-relaxed`}
          placeholder="What happened, what you expected, and roughly when. Which browser or device helps too."
        />
        <div className="flex flex-wrap items-start justify-between gap-x-4">
          <p id={id("message-hint")} className={hint}>
            Don&apos;t include passwords or two-step codes. To report a vulnerability, email {SECURITY_MAILBOX}.
          </p>
          <p className={`${hint} tabular-nums`} aria-hidden>
            {message.trim().length}/{SUPPORT_LIMITS.message}
          </p>
        </div>
        {errors.message ? (
          <p id={id("message-error")} className={errorCls}>
            {errors.message}
          </p>
        ) : null}
      </div>

      {/* A field people never see: bots fill it in, and requests that have it are dropped. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {formError ? (
        <p role="alert" className={`rounded-[8px] bg-danger-soft px-3 py-2 ${site ? "text-[14px]" : "text-sm"} text-danger`}>
          {formError}
        </p>
      ) : null}

      <div className={`flex flex-wrap items-center gap-2 ${site ? "" : "justify-end"}`}>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {site ? (
          <button type="submit" className="mk-btn mk-btn-primary h-11 px-5 text-[15px]" aria-busy={busy || undefined} disabled={busy}>
            {busy ? "Sending…" : "Send message"}
          </button>
        ) : (
          <Button type="submit" variant="primary" aria-busy={busy || undefined} disabled={busy}>
            {busy ? "Sending…" : "Send message"}
          </Button>
        )}
      </div>
    </form>
  );
}
