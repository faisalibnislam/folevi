"use client";

import { useState } from "react";
import { useAppState } from "@/lib/app/state";
import { useEngineState } from "@/lib/hooks/useEngine";
import { clearAllLocalData } from "@/lib/sync/db";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Card } from "./Card";
import { t } from "@/i18n";

export function SyncSection() {
  const { engine, deviceId, online } = useAppState();
  const state = useEngineState(engine);
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const unsent = state.pending.length + state.inflight.length;
  return (
    <>
      <Card title="This device" description="Folevi keeps your recent documents and every unsent change in this browser, so you can keep writing offline and nothing is lost if the tab closes.">
        <dl className="grid max-w-md grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Connection</dt>
          <dd>{online ? "Online" : "Offline"}</dd>
          <dt className="text-muted">Changes waiting to sync</dt>
          <dd className="tabular-nums">
            {unsent} <span className="text-xs text-faint">(Personal, workspaces and shared pages)</span>
          </dd>
          <dt className="text-muted">Uploads waiting</dt>
          <dd className="tabular-nums">{state.uploads.length}</dd>
          <dt className="text-muted">Unresolved conflicts</dt>
          <dd className="tabular-nums">{state.conflicts.length}</dd>
          <dt className="text-muted">Device id</dt>
          <dd className="truncate font-mono text-xs">{deviceId}</dd>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => engine?.scheduleFlush(0)}>Sync now</Button>
          <Button variant="quiet" className="text-danger" onClick={() => setConfirm(true)}>
            Clear data on this device…
          </Button>
        </div>
      </Card>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Clear local data?"
        description={
          unsent ? t("settings.sync.unsent", { count: unsent }) : "Your documents stay in your account. This browser will download them again."
        }
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() =>
                void clearAllLocalData().then(() => {
                  toast.show("Local data cleared");
                  location.reload();
                })
              }
            >
              Clear
            </Button>
          </>
        }
      />
    </>
  );
}
