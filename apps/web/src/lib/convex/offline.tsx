"use client";

import type { ReactNode } from "react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";

/*
 * A Convex client with no server, for app components drawn outside the app (the marketing site's replicas, the
 * dev pages): every query stays loading and every call is refused. A note card (DocumentCard.tsx NoteCardFace)
 * asks for its cover image this way, so a folder card's notes need it wherever they are drawn.
 */
const noWatch = {
  onUpdate: () => () => undefined,
  localQueryResult: () => undefined,
  journal: () => undefined,
  localQueryLogs: () => undefined,
};
const refuse = () => Promise.reject(new Error("Offline"));

export const OFFLINE_CONVEX = {
  watchQuery: () => noWatch,
  watchPaginatedQuery: () => noWatch,
  query: refuse,
  mutation: refuse,
  action: refuse,
  connectionState: () => ({ isWebSocketConnected: false, hasInflightRequests: false }),
} as unknown as ConvexReactClient;

/** Gives its children the server-less client above. */
export function OfflineConvex({ children }: { children: ReactNode }) {
  return <ConvexProvider client={OFFLINE_CONVEX}>{children}</ConvexProvider>;
}
