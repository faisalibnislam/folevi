import { describe, expect, test } from "vitest";
import { parseRoute } from "@/lib/app/router";
import { APP_ROUTE_HEADS } from "@/lib/app/routes";

describe("members and guests routes", () => {
  test("the Guests settings page and the page-invitation link are product routes", () => {
    expect(parseRoute("/settings/workspace-guests")).toEqual({ name: "settings", section: "workspace-guests" });
    expect(parseRoute("/share-invite/AbCdEf123")).toEqual({ name: "share-invite", token: "AbCdEf123" });
    expect(parseRoute("/share-invite")).toEqual({ name: "not_found" });
    expect(APP_ROUTE_HEADS.has("share-invite")).toBe(true);
  });
});
