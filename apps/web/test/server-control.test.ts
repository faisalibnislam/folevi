import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { controlRoute } = await import("@/lib/server-edition/control");

describe("the admin panel's way to folevid", () => {
  test("admins read; the owner changes backups and remote access", () => {
    expect(controlRoute("GET", "status")?.access).toBe("admin");
    expect(controlRoute("GET", "logs")?.query).toEqual(["service", "lines"]);
    expect(controlRoute("POST", "backups")?.access).toBe("owner");
    expect(controlRoute("POST", "backups/2026-11-25T03-00-00/restore")?.access).toBe("owner");
    expect(controlRoute("PUT", "remote")?.access).toBe("owner");
    expect(controlRoute("POST", "diagnostics")?.access).toBe("admin");
  });
  test("nothing else gets through", () => {
    expect(controlRoute("GET", "secrets")).toBeNull();
    expect(controlRoute("DELETE", "backups")).toBeNull();
    expect(controlRoute("POST", "backups/../../etc/restore")).toBeNull();
    expect(controlRoute("GET", "status/../logs")).toBeNull();
  });
});
