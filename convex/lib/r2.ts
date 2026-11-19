// Cloudflare R2 for file bytes (docs/PRICING_PROPOSAL.md, section 5). R2 has free downloads, so the
// /files/ route sends people to a short-lived R2 link instead of serving bytes from Convex, whose downloads
// are billed per GB with no upper limit.
//
// R2 speaks the S3 API; requests are signed here with AWS Signature Version 4 (WebCrypto, no SDK). Settings
// (Convex environment, one bucket per deployment, a token limited to that bucket):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// Without all four, R2 is off and every file stays on Convex storage exactly as before.

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function r2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** The R2 object key for a stored Convex blob (one object per blob, shared by every file row using it). */
export const r2KeyFor = (storageId: string) => `blobs/${storageId}`;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (data: string | Uint8Array) => hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : (data as Uint8Array<ArrayBuffer>)));
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", k, enc.encode(data));
}
/** RFC 3986 encoding, as SigV4 wants it (path segments keep their slashes). */
const uriEncode = (s: string, keepSlash = false) =>
  encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(keepSlash ? /%2F/g : /$^/, "/");

/** "20130524T000000Z" and "20130524". */
function stamps(now: number) {
  const amz = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amz, day: amz.slice(0, 8) };
}

async function signingKey(secret: string, day: string, region: string, service: string) {
  const kDate = await hmac(enc.encode(`AWS4${secret}`), day);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return await hmac(kService, "aws4_request");
}

export interface SignTarget {
  host: string;
  /** The object's path, starting with "/" (bucket included for path-style hosts). */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * A presigned URL (query-string SigV4) for `method` on an object, valid `expiresSeconds`. `query` adds
 * signed parameters such as response-content-disposition.
 */
export async function presign(t: SignTarget, method: string, expiresSeconds: number, now: number, query: Record<string, string> = {}): Promise<string> {
  const { amz, day } = stamps(now);
  const scope = `${day}/${t.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    ...query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${t.accessKeyId}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k]!)}`)
    .join("&");
  const path = uriEncode(t.path, true);
  const canonical = [method, path, canonicalQuery, `host:${t.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, await sha256Hex(canonical)].join("\n");
  const signature = hex(await hmac(await signingKey(t.secretAccessKey, day, t.region, "s3"), toSign));
  return `https://${t.host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Headers for a signed request (header SigV4), for requests the server makes itself. */
export async function signedHeaders(t: SignTarget, method: string, now: number, body?: Uint8Array, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { amz, day } = stamps(now);
  const scope = `${day}/${t.region}/s3/aws4_request`;
  const payloadHash = await sha256Hex(body ?? "");
  const headers: Record<string, string> = { ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v])), host: t.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amz };
  const names = Object.keys(headers).sort();
  const canonical = [method, uriEncode(t.path, true), "", names.map((n) => `${n}:${headers[n]!.trim()}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, await sha256Hex(canonical)].join("\n");
  const signature = hex(await hmac(await signingKey(t.secretAccessKey, day, t.region, "s3"), toSign));
  const { host: _host, ...rest } = headers;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${t.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

/** Where an R2 object lives (path-style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>). */
export function r2Target(c: R2Config, key: string): SignTarget {
  return { host: `${c.accountId}.r2.cloudflarestorage.com`, path: `/${c.bucket}/${key}`, region: "auto", accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey };
}

/** How long a download link from the /files/ route lasts. */
export const DOWNLOAD_LINK_SECONDS = 5 * 60;

/** A short-lived link to download an object, with the type and disposition the /files/ route decided. */
export async function r2DownloadUrl(c: R2Config, key: string, opts: { contentType: string; disposition: string }, now = Date.now()): Promise<string> {
  return await presign(r2Target(c, key), "GET", DOWNLOAD_LINK_SECONDS, now, {
    "response-content-type": opts.contentType,
    "response-content-disposition": opts.disposition,
    "response-cache-control": "private, max-age=3600",
  });
}

/** Uploads bytes to an object (the server's own copy job). */
export async function r2Put(c: R2Config, key: string, bytes: Uint8Array, contentType: string, now = Date.now()): Promise<void> {
  const t = r2Target(c, key);
  const headers = await signedHeaders(t, "PUT", now, bytes, { "content-type": contentType });
  const res = await fetch(`https://${t.host}${uriEncode(t.path, true)}`, { method: "PUT", headers, body: bytes as Uint8Array<ArrayBuffer> });
  if (!res.ok) throw new Error(`R2 PUT failed (${res.status})`);
}

/** An object's size, or null when it isn't there. */
export async function r2Size(c: R2Config, key: string, now = Date.now()): Promise<number | null> {
  const t = r2Target(c, key);
  const res = await fetch(`https://${t.host}${uriEncode(t.path, true)}`, { method: "HEAD", headers: await signedHeaders(t, "HEAD", now) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD failed (${res.status})`);
  return Number(res.headers.get("content-length"));
}

/** Deletes an object (deleting one that isn't there succeeds). */
export async function r2Delete(c: R2Config, key: string, now = Date.now()): Promise<void> {
  const t = r2Target(c, key);
  const res = await fetch(`https://${t.host}${uriEncode(t.path, true)}`, { method: "DELETE", headers: await signedHeaders(t, "DELETE", now) });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed (${res.status})`);
}
