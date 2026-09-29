import { describe, expect, it } from "vitest";
import { isOverdue, taskViews } from "../src";

describe("task views", () => {
  const today = "2026-09-25";
  it("treats unassigned open tasks in Personal as mine", () => {
    expect(taskViews({ status: "open", dueDate: null, assigneeId: null }, today, "me", { personal: true })).toEqual(["all", "inbox", "mine"]);
    expect(taskViews({ status: "open", dueDate: "2026-09-30", assigneeId: null }, today, "me", { personal: true })).toEqual(["all", "upcoming", "mine"]);
    // Team workspaces: unassigned tasks are nobody's yet.
    expect(taskViews({ status: "open", dueDate: null, assigneeId: null }, today, "me")).toEqual(["all", "inbox"]);
    expect(taskViews({ status: "open", dueDate: null, assigneeId: "you" }, today, "me", { personal: true })).toEqual(["all"]);
  });
  it("lists canceled tasks with completed ones", () => {
    expect(taskViews({ status: "canceled", dueDate: "2026-09-01", assigneeId: "me" }, today, "me")).toEqual(["completed"]);
    expect(isOverdue({ status: "canceled", dueDate: "2026-09-01" }, today)).toBe(false);
  });
});
