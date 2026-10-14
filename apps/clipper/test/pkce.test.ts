// PKCE helpers: the RFC 7636 example, and verifiers of the right length and alphabet.
import { expect, test } from "vitest";
import { challengeFor, newPkce, randomToken } from "../src/lib/pkce";

test("the S256 challenge matches RFC 7636's worked example", async () => {
  expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("verifiers are 43 base64url characters and never repeat", async () => {
  const a = randomToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(randomToken()).not.toBe(a);
  const p = await newPkce();
  expect(p.challenge).toBe(await challengeFor(p.verifier));
  expect(p.state).toMatch(/^[A-Za-z0-9_-]{22}$/);
});
