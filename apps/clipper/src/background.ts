// Folevi Web Clipper's service worker: signs in (Folevi's OAuth server in a browser window, through
// chrome.identity), saves clips (create_note over Folevi's MCP endpoint, into the Inbox page), lists the
// places the connection may use, and handles the "Clip to Folevi" context menu on pages, selections and
// links. The popup asks for all of this by message (lib/messages.ts), so nothing is lost when it closes.
import { FOLEVI_ORIGIN } from "./config";
import { chromeStore } from "./lib/chromeStore";
import { CantReadPage, extractFromTab } from "./lib/extract";
import { FoleviMcp, McpError } from "./lib/mcp";
import type { LastClip, Request, Response, StateResponse } from "./lib/messages";
import { buildNote, type Clip } from "./lib/note";
import { authorizeUrl, clientKnown, codeFromRedirect, exchangeCode, OAuthError, registerClient } from "./lib/oauth";
import { newPkce } from "./lib/pkce";
import { Session, SignedOutError } from "./lib/session";

const session = new Session({ origin: FOLEVI_ORIGIN, local: chromeStore(chrome.storage.local), memory: chromeStore(chrome.storage.session), fetch: (input, init) => fetch(input, init) });
const mcp = new FoleviMcp(session, FOLEVI_ORIGIN);

const MENU_ID = "clip-to-folevi";

// ---------------------------------------------------------------- signing in

let signingIn: Promise<void> | null = null;

/** One sign-in at a time (the popup and the context menu can both ask). */
function signIn(): Promise<void> {
  signingIn ??= doSignIn().finally(() => {
    signingIn = null;
  });
  return signingIn;
}

async function doSignIn(): Promise<void> {
  const redirectUri = chrome.identity.getRedirectURL();
  const pkce = await newPkce();
  let client = await session.client();
  const urlFor = (clientId: string) => authorizeUrl(FOLEVI_ORIGIN, { clientId, redirectUri, challenge: pkce.challenge, state: pkce.state });
  // Register once per install (again if the extension's address changed or Folevi no longer knows it).
  if (!client || client.redirectUri !== redirectUri || !(await clientKnown(urlFor(client.clientId)))) {
    client = { clientId: await registerClient(FOLEVI_ORIGIN, redirectUri), redirectUri };
    await session.setClient(client);
  }
  let redirected: string | undefined;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url: urlFor(client.clientId), interactive: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    throw new Error(/did not approve|cancel/i.test(message) ? "Sign-in was closed before it finished." : "Couldn't open Folevi's sign-in page. Check your connection and try again.");
  }
  if (!redirected) throw new Error("Sign-in was closed before it finished.");
  const code = codeFromRedirect(redirected, redirectUri, pkce.state);
  const tokens = await exchangeCode(FOLEVI_ORIGIN, { clientId: client.clientId, redirectUri, code, verifier: pkce.verifier });
  if (!tokens.refreshToken) throw new OAuthError("no_refresh_token", "Folevi didn't keep you signed in. Try again.");
  await session.save(tokens);
}

// ---------------------------------------------------------------- saving

async function lastPlace(): Promise<string | null> {
  const { lastPlace: value } = await chrome.storage.local.get("lastPlace");
  return typeof value === "string" ? value : null;
}

async function remember(last: LastClip): Promise<void> {
  await chrome.storage.session.set({ lastClip: last });
}

/** Saves a clip into the Inbox of `place` (or Personal). A place that's gone is forgotten and Personal used. */
async function save(clip: Clip, place: string | undefined) {
  const note = buildNote(clip, new Date());
  try {
    let created;
    try {
      created = await mcp.createNote({ ...note, place });
    } catch (e) {
      if (!(place && e instanceof McpError && /can't use the place/.test(e.message))) throw e;
      await chrome.storage.local.remove("lastPlace");
      created = await mcp.createNote(note);
    }
    if (place) await chrome.storage.local.set({ lastPlace: place });
    await remember({ ok: true, title: created.title, url: created.url, place: created.place, at: Date.now() });
    return created;
  } catch (e) {
    await remember({ ok: false, title: note.title, error: messageOf(e), at: Date.now() });
    throw e;
  }
}

function messageOf(e: unknown): string {
  if (e instanceof SignedOutError || e instanceof McpError || e instanceof OAuthError || e instanceof CantReadPage) return e.message;
  if (e instanceof Error && e.message && !/fetch|network/i.test(e.message)) return e.message;
  return "Couldn't reach Folevi. Check your connection and try again.";
}

// ---------------------------------------------------------------- toolbar badge (context menu clips)

async function badge(state: "busy" | "ok" | "error", title?: string) {
  const text = state === "busy" ? "..." : state === "ok" ? "OK" : "!";
  await chrome.action.setBadgeBackgroundColor({ color: state === "error" ? "#B42318" : "#111111" });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title: title ?? "Folevi Web Clipper" });
  if (state !== "busy") {
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: "" });
      void chrome.action.setTitle({ title: "Folevi Web Clipper" });
    }, 5000);
  }
}

// ---------------------------------------------------------------- context menu

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Clip to Folevi", contexts: ["page", "selection", "link"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
  void clipFromMenu(info, tab as chrome.tabs.Tab & { id: number });
});

async function clipFromMenu(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab & { id: number }) {
  try {
    await badge("busy", "Clipping to Folevi");
    if (!(await session.signedIn())) await signIn();
    const pageUrl = info.pageUrl ?? tab.url ?? "";
    const pageTitle = tab.title ?? "";
    let clip: Clip;
    if (info.selectionText) {
      const page = await extractFromTab(tab.id, "selection").catch(() => null);
      const markdown = page?.markdown || info.selectionText.replace(/([\\`*_[\]])/g, "\\$1");
      clip = { kind: "selection", title: pageTitle || page?.title || "", pageUrl, markdown };
    } else if (info.linkUrl) {
      const page = await extractFromTab(tab.id, "link", info.linkUrl).catch(() => null);
      clip = { kind: "link", title: page?.title || info.linkUrl, pageUrl, pageTitle, markdown: "", linkUrl: info.linkUrl };
    } else {
      const page = await extractFromTab(tab.id, "article");
      clip = { kind: "article", title: page.title, pageUrl: page.url, markdown: page.markdown, byline: page.byline, siteName: page.siteName };
    }
    await save(clip, (await lastPlace()) ?? undefined);
    await badge("ok", "Saved to your Folevi Inbox");
  } catch (e) {
    await remember({ ok: false, title: tab.title ?? "", error: messageOf(e), at: Date.now() });
    await badge("error", messageOf(e));
  }
}

// ---------------------------------------------------------------- popup messages

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case "state": {
      // The last clip's result is shown once (a context-menu clip, or a popup that closed while saving).
      const { lastClip } = await chrome.storage.session.get("lastClip");
      await chrome.storage.session.remove("lastClip");
      return { signedIn: await session.signedIn(), lastPlace: await lastPlace(), lastClip: (lastClip as LastClip | undefined) ?? null } satisfies StateResponse;
    }
    case "signIn":
      await signIn();
      return null;
    case "signOut":
      await session.signOut();
      await chrome.storage.local.remove("lastPlace");
      await chrome.storage.session.remove("lastClip");
      return null;
    case "places":
      return await mcp.listPlaces();
    case "save":
      return await save(request.clip, request.place);
  }
}

chrome.runtime.onMessage.addListener((request: Request, sender, sendResponse: (r: Response<unknown>) => void) => {
  // Only this extension's own pages (the popup) talk to the service worker, never a script in a web page.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  handle(request).then(
    (value) => sendResponse({ ok: true, value }),
    (e: unknown) => sendResponse({ ok: false, error: messageOf(e), signedOut: e instanceof SignedOutError }),
  );
  return true;
});
