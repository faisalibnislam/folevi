import { expect, test } from "vitest";
import { BUILT_IN_TEMPLATES } from "@/lib/templates";
import { TEMPLATE_NAMES } from "@/lib/templateNames";

test("the template name list matches the built-in templates", () => {
  expect(TEMPLATE_NAMES).toEqual(BUILT_IN_TEMPLATES.map((t) => ({ key: t.key, name: t.name })));
});
