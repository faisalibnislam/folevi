"use client";

// The chart's connectors, routed (routeFlowchart: ports spread along sides, elbow, curved and straight
// routes around shapes, overlaps moved apart, hops at crossings) and drawn. The router caches each
// connector's route by what it depends on, so a frame of dragging only routes the connectors near what
// moved; and every connector that looks the same as last frame keeps last frame's object, so the memoised
// connector items (layers/Connectors.tsx) only redraw the ones that changed.
import { useMemo, useRef } from "react";
import { routeEdges, type FlowchartData, type RoutedEdge } from "../schema";
import { stableRouted } from "../connectors";

export function useRouted(doc: FlowchartData): RoutedEdge[] {
  const prev = useRef<ReadonlyMap<string, RoutedEdge>>(new Map());
  return useMemo(() => {
    const next = stableRouted(prev.current, routeEdges(doc));
    prev.current = new Map(next.map((r) => [r.edge.id, r]));
    return next;
  }, [doc]);
}
