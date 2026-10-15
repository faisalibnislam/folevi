import { createHash, randomBytes } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// Connecting an app the way Claude or ChatGPT does: discover the server, register (RFC 7591), authorize
// with PKCE, approve on Folevi's consent screen, trade the code for a token, then call a tool.
test("an app connects through OAuth and the consent screen, then reads notes over MCP", async ({ browser }) => {
  const { page } = await newPerson(browser, "Connected Person");
  // The app's own requests: no Folevi cookies (it's another program), only its token once it has one.
  const api = await request.newContext();

  // Discovery: the 401 names the resource metadata, which names the authorization server.
  const unauth = await api.post(`${APP}/mcp`, { data: { jsonrpc: "2.0", id: 1, method: "tools/list" }, failOnStatusCode: false });
  expect(unauth.status()).toBe(401);
  expect(unauth.headers()["www-authenticate"]).toContain("resource_metadata=");
  const prm = await (await api.get(`${APP}/.well-known/oauth-protected-resource/mcp`)).json();
  expect(prm.resource).toMatch(/\/mcp$/);
  expect(prm.authorization_servers[0]).toMatch(/\/api\/auth$/);
  const asMeta = await (await api.get(`${APP}/.well-known/oauth-authorization-server/api/auth`)).json();
  expect(asMeta.code_challenge_methods_supported).toContain("S256");
  expect(asMeta.scopes_supported).toEqual(expect.arrayContaining(["notes:read", "tasks:write"]));

  // Registration (no credentials: a public client).
  const redirectUri = "http://127.0.0.1:47619/callback";
  const reg = await api.post(`${APP}/api/auth/oauth2/register`, {
    data: { client_name: "E2E Assistant", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "notes:read tasks:read offline_access" },
  });
  expect(reg.ok()).toBe(true);
  const { client_id } = await reg.json();

  // Authorize as the signed-in person: Folevi sends them to the consent screen.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(`${APP}/api/auth/oauth2/authorize`);
  for (const [k, v] of Object.entries({ response_type: "code", client_id, redirect_uri: redirectUri, scope: "notes:read tasks:read offline_access", state: "s123", code_challenge: challenge, code_challenge_method: "S256", resource: prm.resource.replace(new URL(APP).origin, new URL(asMeta.issuer as string).origin) })) {
    authorize.searchParams.set(k, v);
  }
  // The person's browser opens the authorize URL (signed in, so Folevi asks for consent): a real page load
  // must be redirected to the consent page, never shown the provider's JSON.
  await page.goto(authorize.toString());
  await page.waitForURL(/\/oauth\/consent\?/);
  expect(await page.locator("body").innerText()).not.toContain('"redirect":true');
  await expect(page.getByRole("heading", { name: "Connect E2E Assistant to Folevi" })).toBeVisible();
  await expect(page.getByText("It will send you back to")).toContainText("127.0.0.1:47619");
  await expect(page.getByRole("checkbox", { name: "Search and read your notes" })).toBeDisabled();

  const back = page.waitForRequest((r) => r.url().startsWith(redirectUri));
  await page.getByRole("button", { name: "Allow" }).click();
  const callback = new URL((await back).url());
  expect(callback.searchParams.get("state")).toBe("s123");
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();

  // The code for a token (PKCE), then a tool call with it.
  const tokenRes = await api.post(`${APP}/api/auth/oauth2/token`, {
    form: { grant_type: "authorization_code", code: code!, redirect_uri: redirectUri, client_id, code_verifier: verifier, resource: authorize.searchParams.get("resource")! },
  });
  expect(tokenRes.status(), await tokenRes.text()).toBe(200);
  const token = await tokenRes.json();
  expect(token.access_token).toMatch(/^fvat_/);
  expect(token.refresh_token).toMatch(/^fvrt_/);

  const tools = await api.post(`${APP}/mcp`, {
    headers: { authorization: `Bearer ${token.access_token}`, "mcp-protocol-version": "2025-06-18" },
    data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_places", arguments: {} } },
  });
  expect(tools.status()).toBe(200);
  expect((await tools.json()).result.structuredContent.places).toEqual([{ id: "personal", name: "Personal" }]);

  // An hour later the access token runs out and the app refreshes: refresh token, its client id (a public
  // client, no secret) and the same resource. The new access token works, and so does the rotated refresh token.
  const refresh = (refreshToken: string) =>
    api.post(`${APP}/api/auth/oauth2/token`, {
      form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id, resource: authorize.searchParams.get("resource")! },
      failOnStatusCode: false,
    });
  const mcp = (bearer: string, id: number, method: string, params: Record<string, unknown> = {}) =>
    api.post(`${APP}/mcp`, { headers: { authorization: `Bearer ${bearer}`, "mcp-protocol-version": "2025-06-18" }, data: { jsonrpc: "2.0", id, method, params }, failOnStatusCode: false });
  const refreshed = await refresh(token.refresh_token);
  expect(refreshed.status(), await refreshed.text()).toBe(200);
  const next = await refreshed.json();
  expect(next.access_token).toMatch(/^fvat_/);
  expect(next.refresh_token).toMatch(/^fvrt_/);
  expect(next.refresh_token).not.toBe(token.refresh_token);
  const init = await api.post(`${APP}/mcp`, { headers: { authorization: `Bearer ${next.access_token}` }, data: { jsonrpc: "2.0", id: 10, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } } });
  expect(init.status()).toBe(200);
  const places = await mcp(next.access_token, 11, "tools/call", { name: "list_places", arguments: {} });
  expect(places.status()).toBe(200);
  expect((await places.json()).result.structuredContent.places).toEqual([{ id: "personal", name: "Personal" }]);
  // The first access token keeps working until it expires.
  expect((await mcp(token.access_token, 12, "tools/list")).status()).toBe(200);
  const again = await refresh(next.refresh_token);
  expect(again.status(), await again.text()).toBe(200);
  const third = await again.json();
  expect((await mcp(third.access_token, 13, "tools/list")).status()).toBe(200);

  // It shows in Settings → Connected apps, where it can be disconnected.
  await page.goto(`${APP}/settings/connected-apps`);
  const row = page.getByRole("listitem", { name: "E2E Assistant" });
  await expect(row).toContainText("Reads only in Personal");
  await row.getByRole("button", { name: "Disconnect…" }).click();
  await row.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText("No apps are connected", { exact: true })).toBeVisible();
  const after = await api.post(`${APP}/mcp`, { headers: { authorization: `Bearer ${token.access_token}` }, data: { jsonrpc: "2.0", id: 3, method: "tools/list" }, failOnStatusCode: false });
  expect(after.status()).toBe(401);
  // Disconnecting ends the refreshed tokens too.
  expect((await mcp(third.access_token, 14, "tools/list")).status()).toBe(401);
  expect((await refresh(third.refresh_token)).status()).toBe(400);
  await api.dispose();
});
