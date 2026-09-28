"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";

type Tone = "neutral" | "success" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<{ show: (message: string, opts?: { tone?: Tone; action?: Toast["action"]; duration?: number }) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (message: string, opts?: { tone?: Tone; action?: Toast["action"]; duration?: number }) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, message, tone: opts?.tone ?? "neutral", action: opts?.action }]);
      setTimeout(() => dismiss(id), opts?.duration ?? (opts?.action ? 8000 : 4500));
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="region" aria-label="Notifications">
        <div aria-live="polite" className="contents">
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-[6px] py-2 pl-5 pr-2.5 text-sm font-medium shadow-[var(--shadow-pop)] animate-[folio-rise_180ms_var(--ease-folio)] ${
                t.tone === "error" ? "bg-danger-soft text-ink" : t.tone === "success" ? "bg-success-soft text-ink" : "bg-[var(--color-accent-strong)] text-[var(--color-accent-ink)]"
              }`}
            >
              <span className="flex-1">{t.message}</span>
              {t.action ? (
                <button
                  type="button"
                  className="rounded-[6px] bg-[color-mix(in_oklab,currentColor_14%,transparent)] px-3 py-1 font-semibold hover:bg-[color-mix(in_oklab,currentColor_22%,transparent)]"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
              <button type="button" aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)}>
                <X size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

/** Converts Convex errors into short, human messages. */
export function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string; code?: string } })?.data;
  if (data?.message) return data.message;
  if (error instanceof Error && /network|fetch|offline/i.test(error.message)) return "You're offline. Your changes are kept on this device.";
  return "Something went wrong. Please try again.";
}
