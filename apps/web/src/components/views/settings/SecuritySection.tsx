"use client";

import { useMutation, useQuery } from "convex/react";
import { Laptop, Monitor, Smartphone } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Card } from "./Card";

export function SecuritySection() {
  const sessions = useQuery(api.users.listSessions, {});
  const revoke = useMutation(api.users.revokeSession);
  const revokeOthers = useMutation(api.users.revokeOtherSessions);
  const resetPassword = useMutation(api.authSupport.requestPasswordReset);
  const toast = useToast();
  return (
    <>
      <Card
        title="Sign-in protection"
        description={
          <>
            Every Folevi account signs in with an email, a password and an authenticator app (TOTP). One-time recovery codes are shown once when you set up the authenticator — keep them somewhere safe.
            When you choose “Remember this browser”, the authenticator step is skipped on that browser for 30 days; signing out or revoking the session below ends that.
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              resetPassword({}).then(
                (r) => toast.show(r.configured ? "Check your email for a password reset link." : "Password reset isn't available in this environment (no identity provider configured)."),
                (e) => toast.show(errorMessage(e), { tone: "error" }),
              )
            }
          >
            Change password
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          To move your authenticator to a new phone, sign in on the new device and use a recovery code, or ask support to reset two-step verification after verifying your identity.
        </p>
      </Card>
      <Card title="Sessions" description="Devices and browsers signed in to your account. Revoking a session signs it out the next time it contacts Folevi.">
        <ul className="divide-y divide-line rounded-[14px] border border-line">
          {sessions === undefined ? <li className="px-4 py-3 text-sm text-muted">Loading…</li> : null}
          {sessions?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-muted" aria-hidden>
                {s.client === "mac" ? <Laptop size={18} /> : /iOS|Android/.test(s.label) ? <Smartphone size={18} /> : <Monitor size={18} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {s.label} {s.current ? <span className="ml-1 rounded-[4px] bg-moss-soft px-1.5 py-0.5 text-[11px] text-moss-ink">This device</span> : null}
                </span>
                <span className="block text-xs text-muted">
                  Signed in {formatDateTime(s.createdAt)} · last active {formatRelative(s.lastSeenAt)}
                  {s.revokedAt ? ` · revoked ${formatRelative(s.revokedAt)}` : ""}
                </span>
              </span>
              {!s.revokedAt && !s.current ? (
                <Button size="sm" onClick={() => void revoke({ sessionId: s.id }).then(() => toast.show("Session revoked"), (e) => toast.show(errorMessage(e), { tone: "error" }))}>
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <Button className="mt-3" onClick={() => void revokeOthers({}).then(() => toast.show("Signed out everywhere else"))}>
          Sign out of all other sessions
        </Button>
      </Card>
    </>
  );
}
