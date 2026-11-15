import { afterEach, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mocks = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn(), toast: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.add, useQuery: () => undefined }));
vi.mock("@/lib/app/state", () => ({ useAppState: () => ({ scope: { kind: "personal" }, today: "2026-11-15", profile: { id: "test" }, online: true }) }));
vi.mock("@/lib/app/router", () => ({ useAppRouter: () => ({ navigate: vi.fn() }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: mocks.toast }), errorMessage: () => "Could not save" }));
vi.mock("@/lib/nlDate", () => ({ useNaturalDatesReady: () => false, parseNaturalDate: () => null }));
vi.mock("@/components/iphone/QuickAddSheet", () => ({ PhoneQuickAdd: () => null }));

import { useQuickAdd } from "@/components/app/QuickAddTask";

let root: Root;
let form: ReturnType<typeof useQuickAdd>;
function Harness() {
  form = useQuickAdd({ onClose: mocks.close });
  return null;
}
async function setup() {
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => root.render(<Harness />));
  await act(async () => form.setTitle("Call the printer"));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

test("two submissions before React renders create one task", async () => {
  let finish!: (value: { documentId: string }) => void;
  mocks.add.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await setup();
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = form.submit();
    second = form.submit();
  });
  expect(mocks.add).toHaveBeenCalledTimes(1);
  expect(form.busy).toBe(true);
  await act(async () => {
    finish({ documentId: "inbox" });
    await Promise.all([first, second]);
  });
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(form.busy).toBe(false);
});

test("a failed save keeps the task and allows a retry", async () => {
  mocks.add.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ documentId: "inbox" });
  await setup();
  await act(async () => form.submit());
  expect(form.title).toBe("Call the printer");
  expect(form.error).toBe("Could not save");
  expect(mocks.close).not.toHaveBeenCalled();
  await act(async () => form.submit());
  expect(mocks.add).toHaveBeenCalledTimes(2);
  expect(mocks.close).toHaveBeenCalledTimes(1);
});
