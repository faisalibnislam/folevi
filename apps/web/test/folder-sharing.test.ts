import { describe, expect, test } from "vitest";
import { folderAccessSummary, moveWarning, roleLabel, sharedPlace } from "@/lib/app/folderSharing";
import { parseRoute } from "@/lib/app/router";

describe("folder sharing words", () => {
  test("roles", () => {
    expect(roleLabel("editor")).toBe("Can edit");
    expect(roleLabel("commenter")).toBe("Can comment");
    expect(roleLabel("viewer")).toBe("Can view");
  });

  test("the access summary counts notes and people", () => {
    expect(folderAccessSummary({ noteCount: 3, people: 2, personal: true })).toBe("People with access to this folder can see its 3 notes, in its subfolders too, and notes added later. It’s shared with 2 people.");
    expect(folderAccessSummary({ noteCount: 1, people: 0, personal: true })).toMatch(/its 1 note,.*Only you can see it now\.$/);
    expect(folderAccessSummary({ noteCount: 0, people: 0, personal: false })).toMatch(/see its notes,.*by each member’s role\.$/);
  });

  test("a move warns only when it changes who can see the notes", () => {
    expect(moveWarning({ gainCount: 0, loseCount: 0, gains: [], loses: [] }, 1, "Work")).toBeNull();
    const lose = moveWarning({ gainCount: 0, loseCount: 1, gains: [], loses: ["Sam"] }, 1, "Private")!;
    expect(lose.title).toBe("Move and stop sharing?");
    expect(lose.message).toBe("Sam will no longer see this note: it was shared with them through the folder it’s in now.");
    const both = moveWarning({ gainCount: 5, loseCount: 2, gains: ["Ann", "Bo", "Cy", "Di", "Ed"], loses: ["Sam", "Lee"] }, 3, "Team")!;
    expect(both.title).toBe("Move and change who can see it?");
    expect(both.message).toBe("Ann, Bo, Cy and 2 more will be able to see these 3 notes through “Team”. Sam and Lee will no longer see these 3 notes: they were shared with them through the folder they’re in now.");
    expect(moveWarning({ gainCount: 2, loseCount: 0, gains: [], loses: [] }, 1, "X")!.message).toMatch(/^2 people will be able/);
  });

  test("places", () => {
    expect(sharedPlace({ workspaceName: "Acme", ownerName: "Sam" })).toBe("Acme");
    expect(sharedPlace({ workspaceName: null, ownerName: "Sam" })).toBe("Personal · Sam");
  });

  test("routes: a shared folder and a folder invitation", () => {
    expect(parseRoute("/shared")).toEqual({ name: "shared" });
    expect(parseRoute("/shared/01ABC")).toEqual({ name: "shared-folder", id: "01ABC" });
    expect(parseRoute("/share-invite/folder/tok123")).toEqual({ name: "folder-invite", token: "tok123" });
    expect(parseRoute("/share-invite/tok123")).toEqual({ name: "share-invite", token: "tok123" });
  });
});
