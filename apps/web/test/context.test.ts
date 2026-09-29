import { describe, expect, test } from "vitest";
import { parseStoredContext, resolveContext, serializeContext, type Workspace } from "@/lib/app/state";
import { documentScope, documentScopeKey, inCurrentScope } from "@/lib/app/scope";

const ws = (id: string, name: string, role: Workspace["role"] = "owner") =>
  ({ id, name, role, icon: null, logoUrl: null, status: "active", storageUsedBytes: 0, storageQuotaBytes: 1, plan: { scope: "workspace", id: "workspace_free", name: "Workspace Free" }, aiIncluded: false }) as Workspace;

describe("active context (Personal or a team workspace)", () => {
  test("defaults to Personal", () => {
    expect(resolveContext(null, [])).toEqual({ kind: "personal" });
    expect(resolveContext(parseStoredContext(null, null), [ws("w1", "Acme")])).toEqual({ kind: "personal" });
  });

  test("reopens a remembered workspace you still belong to", () => {
    const acme = ws("w1", "Acme", "admin");
    const context = resolveContext(parseStoredContext(serializeContext({ kind: "workspace", workspaceId: "w1" }), null), [acme]);
    expect(context).toEqual({ kind: "workspace", workspaceId: "w1", name: "Acme", role: "admin", workspace: acme });
  });

  test("a workspace you left (or never had) opens Personal", () => {
    expect(resolveContext(parseStoredContext("workspace:gone", null), [ws("w1", "Acme")])).toEqual({ kind: "personal" });
  });

  test("an older build's remembered workspace: a team workspace stays, the old personal workspace becomes Personal", () => {
    const teams = [ws("w-team", "Acme")];
    expect(resolveContext(parseStoredContext(null, "w-team"), teams)).toMatchObject({ kind: "workspace", workspaceId: "w-team" });
    expect(resolveContext(parseStoredContext(null, "w-old-personal"), teams)).toEqual({ kind: "personal" });
    // The new setting wins over the legacy one.
    expect(resolveContext(parseStoredContext("personal", "w-team"), teams)).toEqual({ kind: "personal" });
  });

  test("Personal is stored without any id", () => {
    expect(serializeContext({ kind: "personal" })).toBe("personal");
    expect(parseStoredContext("personal", null)).toEqual({ kind: "personal" });
    expect(parseStoredContext("workspace:", null)).toBeNull();
  });
});

describe("a document's scope vs the current context", () => {
  test("Personal documents (workspaceId null) belong to Personal; workspace documents to their workspace", () => {
    expect(documentScope({ workspaceId: null })).toEqual({ kind: "personal" });
    expect(documentScope({ workspaceId: "w1" })).toEqual({ kind: "workspace", workspaceId: "w1" });
    expect(documentScopeKey({ workspaceId: null })).toBe("personal");
    expect(inCurrentScope({ workspaceId: null }, true, "personal")).toBe(true);
    expect(inCurrentScope({ workspaceId: null }, true, "w1")).toBe(false);
    expect(inCurrentScope({ workspaceId: "w1" }, true, "w1")).toBe(true);
    // Someone else's Personal shared with you is never "your" Personal.
    expect(inCurrentScope({ workspaceId: null, ownerProfileId: "someone" }, false, "personal")).toBe(false);
  });
});
