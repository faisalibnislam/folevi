"use client";

// Folevi's own versions of lib/native/ui.ts's native pieces, for the website, the Mac app and an app without
// them: the confirmation and one-field dialogs, a short list of choices, and the date and time picker. Each
// call mounts its own dialog (components/ui/Dialog.tsx: a sheet in the iPhone layout) in a root of its own
// at the end of the page and takes it away when it's answered. Loaded only when one is needed.

import { useId, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Calendar, TimeField, todayLocal } from "@/components/ui/DateField";
import { useIphoneApp } from "@/lib/iphone";
import type { AskTextOptions, ChoiceAction, ConfirmOptions, PickDateOptions } from "./ui";

/** Shows `render`'s dialog until it answers (dismissing it is an answer too); resolves with the answer. */
function mount<T>(render: (answer: (value: T) => void) => React.ReactNode): Promise<T> {
  return new Promise<T>((resolve) => {
    const host = document.createElement("div");
    host.dataset.nativeFallback = "";
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const answer = (value: T) => {
      if (done) return;
      done = true;
      resolve(value);
      // (After the dialog's own close has run: the browser hands focus back first.)
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    flushSync(() => root.render(render(answer)));
  });
}

export function showConfirm(o: ConfirmOptions): Promise<boolean> {
  return mount<boolean>(
    (answer) => (
      <Dialog
        open
        onClose={() => answer(false)}
        title={o.title}
        description={o.message}
        size="sm"
        footer={
          <>
            <Button onClick={() => answer(false)}>{o.cancel ?? "Cancel"}</Button>
            <Button variant={o.destructive ? "danger" : "primary"} onClick={() => answer(true)} autoFocus>
              {o.confirm}
            </Button>
          </>
        }
      />
    ),
  );
}

function AskTextForm({ o, answer }: { o: AskTextOptions; answer: (v: string | null) => void }) {
  const [value, setValue] = useState(o.value ?? "");
  const id = useId();
  return (
    <Dialog open onClose={() => answer(null)} title={o.title} description={o.message} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = value.trim();
          if (text) answer(text);
        }}
      >
        <label className="block text-subheadline font-medium" htmlFor={id}>
          {o.label ?? (o.placeholder || o.title)}
        </label>
        <input
          id={id}
          autoFocus
          value={value}
          placeholder={o.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          maxLength={o.maxLength ?? 80}
          autoCapitalize={o.capitalize === "none" ? "off" : o.capitalize}
          className="ui-input mt-2 h-10 w-full rounded-chip px-3 text-callout pointer-coarse:h-11 pointer-coarse:text-body"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => answer(null)}>{o.cancel ?? "Cancel"}</Button>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            {o.confirm ?? "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function showAskText(o: AskTextOptions): Promise<string | null> {
  return mount<string | null>((answer) => <AskTextForm o={o} answer={answer} />);
}

export function showChoice(o: { title?: string; message?: string; actions: ChoiceAction[]; cancel?: string }): Promise<string | null> {
  return mount<string | null>(
    (answer) => (
      <Dialog open onClose={() => answer(null)} title={o.title ?? "Choose"} description={o.message} size="sm">
        <div className="flex flex-col gap-2">
          {o.actions.map((a) => (
            <Button key={a.id} variant={a.destructive ? "danger" : "secondary"} className="w-full justify-center" onClick={() => answer(a.id)}>
              {a.title}
            </Button>
          ))}
          <Button variant="ghost" className="w-full justify-center" onClick={() => answer(null)}>
            {o.cancel ?? "Cancel"}
          </Button>
        </div>
      </Dialog>
    ),
  );
}

function PickDateForm({ o, answer }: { o: PickDateOptions; answer: (v: { value: string | null } | null) => void }) {
  const [initialDate, initialTime] = (() => {
    const v = o.value ?? "";
    if (o.mode === "time") return ["", /^\d{2}:\d{2}$/.test(v) ? v : ""];
    if (o.mode === "dateAndTime") {
      const [d, t] = v.split("T");
      return [d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "", t && /^\d{2}:\d{2}$/.test(t) ? t : ""];
    }
    return [/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "", ""];
  })();
  const [date, setDate] = useState(initialDate || (o.mode === "time" ? "" : todayLocal()));
  const [time, setTime] = useState(initialTime || (o.mode === "date" ? "" : "09:00"));
  const result = (): string | null => {
    if (o.mode === "date") return date || null;
    if (o.mode === "time") return time || null;
    return date && time ? `${date}T${time}` : null;
  };
  const within = (v: string | null) => !!v && (!o.min || v >= o.min) && (!o.max || v <= o.max);
  // A date picked on its own (no time to set) is the answer.
  const pickDay = (d: string) => {
    setDate(d);
    if (o.mode === "date" && within(d)) answer({ value: d });
  };
  const value = result();
  const phone = useIphoneApp();
  return (
    <Dialog
      open
      onClose={() => answer(null)}
      title={o.title ?? (o.mode === "time" ? "Time" : "Date")}
      size="sm"
      footer={
        <>
          {o.clearable ? <Button onClick={() => answer({ value: null })}>Clear</Button> : null}
          <Button variant="primary" disabled={!within(value)} onClick={() => answer({ value })}>
            Done
          </Button>
        </>
      }
    >
      {/* In the phone layout the dialog is a glass card: the month fills it, with days a finger can hit. */}
      {o.mode !== "time" ? <Calendar value={date || null} onPick={pickDay} autoFocus fill={phone} /> : null}
      {o.mode !== "date" ? (
        <div className={o.mode === "dateAndTime" ? "mt-3" : ""}>
          <TimeField value={time} onChange={setTime} allowEmpty={false} size="lg" aria-label="Time" className="w-full" />
        </div>
      ) : null}
    </Dialog>
  );
}

export function showPickDate(o: PickDateOptions): Promise<{ value: string | null } | null> {
  return mount<{ value: string | null } | null>((answer) => <PickDateForm o={o} answer={answer} />);
}
