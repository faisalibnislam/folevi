// @vitest-environment edge-runtime
// The E2EE core in a web runtime (the app's web view, the Convex-like edge runtime): every vector of
// fixtures/e2ee-vectors.json is recomputed on each backend the runtime supports, as in e2ee-vectors.test.ts.
import { afterAll, describe, expect, it } from "vitest";
import vectors from "../fixtures/e2ee-vectors.json";
import { cryptoBackend, forceBackend, type BackendName } from "../src/crypto/e2ee";
import { computeVectors } from "./e2ee-helpers";

afterAll(() => forceBackend(null));

describe("e2ee in a web runtime", () => {
  it("detects a backend for every primitive", async () => {
    forceBackend(null);
    const b = await cryptoBackend();
    expect(Object.keys(b).sort()).toEqual(["aes", "ed25519", "x25519"]);
  });

  for (const backend of ["webcrypto", "noble"] as BackendName[]) {
    it(`${backend}: recomputes every vector`, async () => {
      forceBackend(null);
      const detected = await cryptoBackend();
      // Only claim WebCrypto where this runtime really has every primitive.
      if (backend === "webcrypto" && Object.values(detected).some((v) => v !== "webcrypto")) return;
      forceBackend(backend);
      const { $description: _d, ...fixture } = vectors;
      expect(JSON.parse(JSON.stringify(await computeVectors()))).toEqual(fixture);
    });
  }
});
