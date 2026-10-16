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

describe("reviews", () => {
  test("/review (and /review?note=…) is a product route", () => {
    expect(parseRoute("/review")).toEqual({ name: "review" });
    expect(APP_ROUTE_HEADS.has("review")).toBe(true);
  });
});

describe("changes", () => {
  test("/changes is a product route", () => {
    expect(parseRoute("/changes")).toEqual({ name: "changes" });
    expect(APP_ROUTE_HEADS.has("changes")).toBe(true);
  });
});

describe("the Inbox", () => {
  test("/inbox opens the Inbox page (folevi://inbox), and /tasks/inbox stays the Tasks view", () => {
    expect(parseRoute("/inbox")).toEqual({ name: "inbox" });
    expect(APP_ROUTE_HEADS.has("inbox")).toBe(true);
    expect(parseRoute("/tasks/inbox")).toEqual({ name: "tasks", view: "inbox" });
  });
});
