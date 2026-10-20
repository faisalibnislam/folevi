// SPIKE S4 (docs/LOCAL_MODE.md): can the bundled shell's signed-in mode work with a bearer session token held
// by native code? Against the local dev server and the DEV Convex deployment only.
//   cd apps/web && E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test --config spikes/playwright.config.ts
// It also writes a short-lived Convex JWT and a storage upload URL for this test account to S4_OUT (a scratch
// file outside the repo), so the Electron (S2) and Simulator (S3) probes can repeat the WebSocket and upload
// checks from the real app://folevi and capacitor://localhost origins.
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { APP, convexUrl, newPerson } from "../../e2e/helpers";

const CLIENT = "folevi-mac";
const REDIRECT = "com.folevi.mac://auth/callback";
const SHELL_ORIGINS = ["app://folevi", "capacitor://localhost"] as const;
const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

type Row = Record<string, unknown>;
const report: Row = {};

test("bearer sign-in, Convex tokens, the WebSocket and storage uploads from the shell's origins", async ({ browser }) => {
  test.setTimeout(180_000);
  const person = await newPerson(browser, "Shell Spike");
  // "Native fetch": no cookies, no Origin header (what Electron net.fetch and URLSession send by default).
  const native = await playwrightRequest.newContext();
  const signInNative = async () => {
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s4" });
    await person.page.goto(`${APP}/connect?${q}`);
    const authorize = person.page.waitForResponse((r) => r.url().includes("/api/auth/native/authorize"));
    await person.page.getByRole("button", { name: "Continue" }).click({ timeout: 30_000 });
    const { code } = (await (await authorize).json()) as { code: string };
    const tokenRes = await native.post(`${APP}/api/auth/native/token`, {
      data: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: CLIENT, redirect_uri: REDIRECT, device_name: "Shell spike" },
    });
    expect(tokenRes.status()).toBe(200);
    return ((await tokenRes.json()) as { access_token: string }).access_token;
  };
  const bearer = await signInNative();
  // A second device session, left signed in, whose Convex JWT the web view probes use.
  const probeBearer = await signInNative();
  const auth = { authorization: `Bearer ${bearer}` };

  // /convex/token and /get-session with the bearer, with no Origin and with each shell origin.
  for (const origin of [null, ...SHELL_ORIGINS]) {
    const headers = origin ? { ...auth, origin } : auth;
    const t = await native.get(`${APP}/api/auth/convex/token`, { headers });
    const s = await native.get(`${APP}/api/auth/get-session`, { headers });
    const session = (await s.json().catch(() => null)) as { user?: { email?: string } } | null;
    report[`convexToken[${origin ?? "none"}]`] = t.status();
    report[`getSession[${origin ?? "none"}]`] = `${s.status()} ${session?.user?.email === person.email ? "same person" : "no session"}`;
    expect(t.status()).toBe(200);
    expect(session?.user?.email).toBe(person.email);
  }
  // The same calls straight to the Convex site (no Next proxy in between), as a host could do.
  const site = convexUrl().replace(".convex.cloud", ".convex.site");
  report["convexToken[direct to convex.site]"] = (await native.get(`${site}/api/auth/convex/token`, { headers: auth })).status();

  // A POST with the bearer and no cookies: does Better Auth's origin check fire? Through the dev proxy (which
  // rewrites any Origin to the dev backend's trusted one, FOLEVI_DEV_AUTH_ORIGIN) and straight to convex.site,
  // which is what production's proxy effectively does (it forwards Origin untouched).
  for (const [label, base] of [["proxy", `${APP}/api/auth`], ["direct", `${site}/api/auth`]] as const) {
    for (const origin of [null, ...SHELL_ORIGINS, new URL(APP).origin, "http://app.localhost:3000"]) {
      const res = await native.post(`${base}/update-user`, { headers: origin ? { ...auth, origin } : auth, data: { name: "Shell Spike" } });
      report[`postUpdateUser[${label}, ${origin ?? "none"}]`] = `${res.status()} ${(await res.text()).slice(0, 80)}`;
    }
  }

  const jwt = ((await (await native.get(`${APP}/api/auth/convex/token`, { headers: auth })).json()) as { token: string }).token;

  // The Convex WebSocket with each shell origin: connect, authenticate with the JWT, run users.me.
  for (const origin of SHELL_ORIGINS) report[`websocket[${origin}]`] = await wsProbe(convexUrl(), jwt, origin);

  // Storage upload: a real upload URL for this account, then a CORS preflight and an upload with each origin.
  const http = new ConvexHttpClient(convexUrl());
  http.setAuth(jwt);
  const uploadUrl = (await http.mutation("files:generateUploadUrl" as never, { scope: { kind: "personal" }, filename: "spike.txt", size: 5, mimeType: "text/plain", kind: "file" } as never)) as unknown;
  const url = typeof uploadUrl === "string" ? uploadUrl : (uploadUrl as { uploadUrl: string }).uploadUrl;
  report.uploadUrlHost = new URL(url).host;
  for (const origin of SHELL_ORIGINS) {
    const pre = await fetch(url, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    report[`uploadPreflight[${origin}]`] = `${pre.status} acao=${pre.headers.get("access-control-allow-origin")} acah=${pre.headers.get("access-control-allow-headers")}`;
  }
  // A second URL for the web view probes (each upload URL is single-use).
  const uploadUrl2 = (await http.mutation("files:generateUploadUrl" as never, { scope: { kind: "personal" }, filename: "spike.txt", size: 5, mimeType: "text/plain", kind: "file" } as never)) as unknown;
  const uploadUrl3 = (await http.mutation("files:generateUploadUrl" as never, { scope: { kind: "personal" }, filename: "spike.txt", size: 5, mimeType: "text/plain", kind: "file" } as never)) as unknown;
  const pick = (u: unknown) => (typeof u === "string" ? u : (u as { uploadUrl: string }).uploadUrl);
  const up = await fetch(url, { method: "POST", headers: { origin: "app://folevi", "content-type": "text/plain" }, body: "hello" });
  report["upload[app://folevi]"] = `${up.status} acao=${up.headers.get("access-control-allow-origin")} ${(await up.text()).slice(0, 60)}`;

  // Sign-out with the bearer from native (the e2e for the Mac app sends the site's Origin; here none).
  const probeJwt = ((await (await native.get(`${APP}/api/auth/convex/token`, { headers: { authorization: `Bearer ${probeBearer}` } })).json()) as { token: string }).token;
  if (process.env.S4_OUT) writeFileSync(process.env.S4_OUT, JSON.stringify({ convexUrl: convexUrl(), jwt: probeJwt, uploadUrls: [pick(uploadUrl2), pick(uploadUrl3)] }));
  const out = await native.post(`${APP}/api/auth/sign-out`, { headers: auth, data: {} });
  report["signOut[no origin]"] = `${out.status()} ${(await out.text()).slice(0, 80)}`;
  const outShell = await native.post(`${APP}/api/auth/sign-out`, { headers: { ...auth, origin: "app://folevi" }, data: {} });
  report["signOut[app://folevi]"] = `${outShell.status()} ${(await outShell.text()).slice(0, 80)}`;
  report["convexToken after sign-out"] = (await native.get(`${APP}/api/auth/convex/token`, { headers: auth })).status();

  console.log(JSON.stringify(report, null, 2));
  await native.dispose();
  await person.context.close();
});

/** The Convex sync protocol by hand (convex/dist/esm/browser/sync): Connect, Authenticate, one query. */
async function wsProbe(deployment: string, jwt: string, origin: string): Promise<Row> {
  const ws = new WebSocket(`${deployment.replace(/^http/, "ws")}/api/1.46.0/sync`, { headers: { Origin: origin } } as never);
  return new Promise((resolve) => {
    const out: Row = { opened: false };
    const done = () => {
      clearTimeout(timer);
      ws.close();
      resolve(out);
    };
    const timer = setTimeout(() => ((out.timeout = true), done()), 15_000);
    ws.onopen = () => {
      out.opened = true;
      ws.send(JSON.stringify({ type: "Connect", sessionId: crypto.randomUUID(), connectionCount: 0, lastCloseReason: "InitialConnect", clientTs: 0 }));
      ws.send(JSON.stringify({ type: "Authenticate", baseVersion: 0, tokenType: "User", value: jwt }));
      ws.send(JSON.stringify({ type: "ModifyQuerySet", baseVersion: 0, newVersion: 1, modifications: [{ type: "Add", queryId: 0, udfPath: "users:me", args: [{}] }] }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { type: string; modifications?: { type: string; value?: { email?: string }; errorMessage?: string }[] };
      out.messages = [...((out.messages as string[]) ?? []), m.type];
      const mod = m.modifications?.find((x) => (x as { queryId?: number }).queryId === 0);
      if (m.type === "Transition" && mod) {
        out.usersMe = mod?.type === "QueryUpdated" ? `ok (${mod.value?.email ? "has email" : "no email"})` : `${mod?.type} ${mod?.errorMessage ?? ""}`;
        done();
      } else if (m.type === "AuthError" || m.type === "FatalError") {
        out.error = m;
        done();
      }
    };
    ws.onclose = (e) => (out.close = `${e.code} ${e.reason}`);
  });
}
