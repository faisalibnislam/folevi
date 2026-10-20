import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { imageBytes, MAX_IMAGE_BYTES, oneAtATime, parseAnswer, runHelper } from "./textRecognition";

const dirs: string[] = [];
/** A stand-in for folevi-text: a shell script with the given body. */
const fakeHelper = (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), "folevi-text-"));
  dirs.push(dir);
  const path = join(dir, "folevi-text");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return { path, dir };
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("reading the words in an image (search in files)", () => {
  test("only a byte array within the limit goes to the helper", () => {
    expect(imageBytes(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(imageBytes(new Uint8Array(0))).toBeNull();
    expect(imageBytes(new Uint8Array(MAX_IMAGE_BYTES + 1))).toBeNull();
    expect(imageBytes("not bytes")).toBeNull();
    expect(imageBytes([1, 2, 3])).toBeNull();
  });

  test("the helper's answer is its text, or nothing", () => {
    expect(parseAnswer('{"text":"Hello\\nworld"}')).toEqual({ text: "Hello\nworld" });
    expect(parseAnswer('{"error":"image"}')).toBeNull();
    expect(parseAnswer("not json")).toBeNull();
    expect(parseAnswer('{"text":42}')).toBeNull();
  });

  test("the image goes in on stdin and the text comes back; handwriting is said so", async () => {
    // Echoes how many bytes it got and its arguments, as the text.
    const { path } = fakeHelper(`n=$(wc -c | tr -d ' '); printf '{"text":"%s bytes %s"}' "$n" "$*"`);
    expect(await runHelper(path, new Uint8Array([1, 2, 3, 4]))).toEqual({ text: "4 bytes " });
    expect(await runHelper(path, new Uint8Array([1]), { handwriting: true })).toEqual({ text: "1 bytes --handwriting" });
  });

  test("a missing helper, a failing one and a slow one answer nothing", async () => {
    expect(await runHelper("/nonexistent/folevi-text", new Uint8Array([1]))).toBeNull();
    const failing = fakeHelper(`cat > /dev/null; printf '{"error":"image"}'; exit 1`);
    expect(await runHelper(failing.path, new Uint8Array([1]))).toBeNull();
    const slow = fakeHelper("cat > /dev/null; sleep 5; printf '{\"text\":\"late\"}'");
    const started = Date.now();
    expect(await runHelper(slow.path, new Uint8Array([1]), { timeoutMs: 200 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("one image at a time", async () => {
    const order: string[] = [];
    const work = oneAtATime(async (name: string, ms: number) => {
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${name}`);
      if (name === "b") throw new Error("b failed");
      return name;
    });
    const results = await Promise.allSettled([work("a", 30), work("b", 5), work("c", 1)]);
    expect(order).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
