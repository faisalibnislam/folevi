"use client";

// Reports the screen the page is showing instead of the app to native (lib/engine/gates.ts), in native chrome
// mode only; renders nothing. Put it next to the web screen it stands for: the web screen stays (hidden behind
// the native one) and its buttons' handlers are the actions native presses.
import { useEffect, useRef } from "react";
import { nativeChrome } from "@/lib/nativeApp";
import { gateEvent, pushGate, type GateHandler } from "./gates";
import type { GateAction, GateChangedEvent } from "./protocol";

export interface NativeGateAction {
  id: string;
  label: string;
  style?: GateAction["style"];
  enabled?: boolean;
  run: GateHandler;
}

export type NativeGateProps = Partial<Omit<GateChangedEvent, "gate" | "actions">> & { gate: string | null; actions?: NativeGateAction[] };

const on = () => typeof window !== "undefined" && nativeChrome() !== null;

export function NativeGate(props: NativeGateProps) {
  const actions = props.actions ?? [];
  const event = gateEvent({ ...props, actions: actions.map((a) => ({ id: a.id, label: a.label, style: a.style ?? "secondary", enabled: a.enabled ?? true })) });
  const json = JSON.stringify(event);
  const runs = useRef(new Map<string, GateHandler>());
  runs.current = new Map(actions.map((a) => [a.id, a.run]));
  const handle = useRef<ReturnType<typeof pushGate> | null>(null);
  // Stable wrappers that call the latest handlers.
  const wrap = (ids: string[]) => new Map(ids.map((id) => [id, (values: Record<string, string>) => runs.current.get(id)?.(values)] as const));

  useEffect(() => {
    if (!on()) return;
    const parsed = JSON.parse(json) as GateChangedEvent;
    const h = pushGate(parsed, wrap(parsed.actions.map((a) => a.id)));
    handle.current = h;
    return () => {
      h.release();
      handle.current = null;
    };
    // Pushed once per mount; later changes go through update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const parsed = JSON.parse(json) as GateChangedEvent;
    handle.current?.update(parsed, wrap(parsed.actions.map((a) => a.id)));
  }, [json]);
  return null;
}
