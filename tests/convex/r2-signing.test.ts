// R2 request signing (convex/lib/r2.ts) against AWS's published Signature Version 4 examples for S3.
import { describe, expect, test } from "vitest";
import { presign, r2Config, r2KeyFor, signedHeaders } from "../../convex/lib/r2";

const example = {
  host: "examplebucket.s3.amazonaws.com",
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const MAY_24_2013 = Date.UTC(2013, 4, 24);

describe("SigV4", () => {
  test("a presigned GET matches AWS's example", async () => {
    const url = await presign({ ...example, path: "/test.txt" }, "GET", 86400, MAY_24_2013);
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  test("a signed GET with headers matches AWS's example", async () => {
    const h = await signedHeaders({ ...example, path: "/test.txt" }, "GET", MAY_24_2013, undefined, { range: "bytes=0-9" });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  test("R2 is off unless all four settings are there", () => {
    expect(r2Config({})).toBeNull();
    expect(r2Config({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c" })).toBeNull();
    expect(r2Config({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" })).toEqual({ accountId: "a", accessKeyId: "b", secretAccessKey: "c", bucket: "d" });
    expect(r2KeyFor("kg2abc")).toBe("blobs/kg2abc");
  });
});
