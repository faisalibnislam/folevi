import { afterEach, expect, test } from "vitest";
import { secretOrDevFallback } from "../../convex/lib/crypto";

const saved = { env: process.env.FOLEVI_ENV, a: process.env.FOLEVI_TEST_SECRET_A };
afterEach(() => {
  process.env.FOLEVI_ENV = saved.env;
  if (saved.a === undefined) delete process.env.FOLEVI_TEST_SECRET_A;
  else process.env.FOLEVI_TEST_SECRET_A = saved.a;
});

test("uses the first secret that is set", () => {
  process.env.FOLEVI_TEST_SECRET_A = "real";
  expect(secretOrDevFallback(["FOLEVI_TEST_SECRET_A"], "stand-in")).toBe("real");
});

test("falls back outside production, never in it", () => {
  delete process.env.FOLEVI_TEST_SECRET_A;
  process.env.FOLEVI_ENV = "test";
  expect(secretOrDevFallback(["FOLEVI_TEST_SECRET_A"], "stand-in")).toBe("stand-in");
  process.env.FOLEVI_ENV = "production";
  expect(() => secretOrDevFallback(["FOLEVI_TEST_SECRET_A"], "stand-in")).toThrow("FOLEVI_TEST_SECRET_A is not set");
});
