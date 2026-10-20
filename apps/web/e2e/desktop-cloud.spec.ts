// Folevi for Mac with the interface built in (FOLEVI_SHELL=1): "Sync with Dropbox" and "Sync with Google Drive"
// reach the page as foleviShell.library.cloud (docs/LOCAL_MODE.md, WP9b). With no network at all
// (fixtures/electronOffline.cjs), a build with only a Dropbox app key offers Dropbox and hides Google Drive (the
// log line saying why is checked in apps/desktop/test/cloud/connection.test.ts); a sign-in opens Dropbox's PKCE page in the browser and waits on 127.0.0.1; a refusal in
// the browser comes back as "cancelled" and leaves nothing connected. No token ever reaches the page.
// Needs the built Mac app (`cd apps/desktop && pnpm build`) and the shell export, on a Mac.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "../../desktop");
const electronBinary = join(
  desktopDir,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const offlineFixture = join(here, "fixtures/electronOffline.cjs");
const shellDir = [join(desktopDir, "web"), resolve(here, "../out-shell")].find((d) =>
  existsSync(join(d, "index.html")),
);
const built =
  existsSync(join(desktopDir, "dist/library/cloud/electron.js")) &&
  existsSync(electronBinary) &&
  Boolean(shellDir);

type Cloud = {
  status(): Promise<{
    available: string[];
    provider: string | null;
    state: string;
    account: string | null;
  }>;
  connect(p: string): Promise<unknown>;
  cancel(): Promise<void>;
  signOut(): Promise<unknown>;
  onStatus(cb: (s: unknown) => void): () => void;
};
// Spelled out inside each evaluate: the page can't see this file's functions.

test("the bundled Mac app offers the built-in cloud connections the build has ids for", async ({
  browserName,
}) => {
  test.skip(
    !built || browserName !== "chromium" || process.platform !== "darwin",
    "Needs the built Mac app and the shell export on a Mac.",
  );
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), "folevi-cloud-e2e-"));
  writeFileSync(
    join(userData, "settings.json"),
    JSON.stringify({ mode: "local", bundledShell: true }),
  );
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: ["-r", offlineFixture, desktopDir],
    env: {
      ...process.env,
      FOLEVI_USER_DATA: userData,
      FOLEVI_SHELL: "1",
      FOLEVI_SHELL_DIR: shellDir!,
      FOLEVI_DROPBOX_APP_KEY: "e2etestkey1234",
      FOLEVI_GOOGLE_DESKTOP_CLIENT_ID: "",
    },
  });
  try {
    // The browser is this test: record the sign-in page instead of opening it.
    await app.evaluate(({ shell }) => {
      (globalThis as { __opened?: string[] }).__opened = [];
      shell.openExternal = async (url: string) => {
        (globalThis as unknown as { __opened: string[] }).__opened.push(url);
      };
    });
    let page: Page | undefined;
    await expect
      .poll(
        () =>
          (page = app
            .windows()
            .find(
              (w) =>
                w.url().startsWith("app://folevi/") &&
                !decodeURIComponent(w.url()).includes("/quick-add"),
            )) !== undefined,
        { timeout: 30_000 },
      )
      .toBe(true);
    await page!.waitForFunction(
      () =>
        typeof (window as { foleviShell?: { library?: { cloud?: unknown } } }).foleviShell?.library
          ?.cloud === "object",
    );

    expect(
      await page!.evaluate(() =>
        (
          window as unknown as { foleviShell: { library: { cloud: Cloud } } }
        ).foleviShell.library.cloud.status(),
      ),
    ).toEqual({ available: ["dropbox"], provider: null, state: "none", account: null });

    // Not a provider: refused with a code the page can read.
    expect(
      await page!.evaluate(() =>
        (
          window as unknown as { foleviShell: { library: { cloud: Cloud } } }
        ).foleviShell.library.cloud
          .connect("onedrive")
          .then(
            () => "connected",
            (e: { code?: string }) => e.code,
          ),
      ),
    ).toBe("invalid_argument");
    expect(
      await page!.evaluate(() =>
        (
          window as unknown as { foleviShell: { library: { cloud: Cloud } } }
        ).foleviShell.library.cloud
          .connect("googleDrive")
          .then(
            () => "connected",
            (e: { code?: string }) => e.code,
          ),
      ),
    ).toBe("unavailable");

    // A sign-in: the status says "connecting", Dropbox's page opens with PKCE and a loopback redirect.
    await page!.evaluate(() => {
      const w = window as unknown as { __states: string[]; __result: Promise<string> };
      w.__states = [];
      (
        window as unknown as { foleviShell: { library: { cloud: Cloud } } }
      ).foleviShell.library.cloud.onStatus((s) => w.__states.push((s as { state: string }).state));
      w.__result = (
        window as unknown as { foleviShell: { library: { cloud: Cloud } } }
      ).foleviShell.library.cloud
        .connect("dropbox")
        .then(
          () => "connected",
          (e: { code?: string }) => e.code ?? "error",
        );
    });
    await expect
      .poll(
        () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.length),
        { timeout: 10_000 },
      )
      .toBe(1);
    const opened = new URL(
      await app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened[0]!),
    );
    expect(opened.origin + opened.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(opened.searchParams.get("client_id")).toBe("e2etestkey1234");
    expect(opened.searchParams.get("code_challenge_method")).toBe("S256");
    expect(opened.searchParams.get("token_access_type")).toBe("offline");
    const redirect = opened.searchParams.get("redirect_uri")!;
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:4175[345]\/$/);

    // The person says no in the browser: Dropbox sends them back with an error.
    const back = new URL(redirect);
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("state", opened.searchParams.get("state")!);
    const answer = await fetch(back);
    expect(await answer.text()).toContain("Folevi wasn't connected to Dropbox");
    expect(
      await page!.evaluate(() => (window as unknown as { __result: Promise<string> }).__result),
    ).toBe("cancelled");
    const states = await page!.evaluate(
      () => (window as unknown as { __states: string[] }).__states,
    );
    expect(states).toContain("connecting");
    expect(states.at(-1)).toBe("none");
    expect(
      await page!.evaluate(() =>
        (
          window as unknown as { foleviShell: { library: { cloud: Cloud } } }
        ).foleviShell.library.cloud.status(),
      ),
    ).toMatchObject({ provider: null, state: "none" });
    expect(existsSync(join(userData, "cloud-tokens.bin"))).toBe(false);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
