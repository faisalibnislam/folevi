// /api/embed (src/app/api/embed/route.ts): the page an embed's player sits in inside the apps. It is a frame's
// page only, and it frames only a player Folevi itself would build.
import { describe, expect, test } from "vitest";
import { embedFor } from "@folevi/editor-schema";
import { GET } from "@/app/api/embed/route";

const PLAYER = embedFor("https://youtu.be/dQw4w9WgXcQ")!.src;
const ask = (src: string, headers: Record<string, string> = { "sec-fetch-dest": "iframe" }) => GET(new Request(`https://app.folevi.com/api/embed?src=${encodeURIComponent(src)}`, { headers }));

describe("/api/embed", () => {
  test("framed, it shows the player", async () => {
    const res = ask(PLAYER);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`<iframe src="${PLAYER}"`);
  });

  test("opened as a page of its own (a link someone was sent), it shows nothing", async () => {
    for (const dest of ["document", "empty", "image", "script", "embed", "object", "frame"]) {
      const res = ask(PLAYER, { "sec-fetch-dest": dest });
      expect(res.status, dest).toBe(403);
      expect(await res.text(), dest).not.toContain("<iframe");
      expect(res.headers.get("cache-control"), dest).toBe("no-store");
    }
  });

  test("with no word on what the request is for (plain http on a home network), it still works", () => {
    expect(ask(PLAYER, {}).status).toBe(200);
  });

  test("it frames a player made again from the address's own parts, nothing carried in", async () => {
    const html = await ask(`${PLAYER}?start=5&autoplay=1&x=%22%3E%3Cscript%3E`).text();
    expect(html).toContain(`<iframe src="${PLAYER}?start=5"`);
    expect(html).not.toContain("autoplay=1");
    expect(html).not.toContain("<script");
  });

  test("any other page of a player's site, or of anywhere else, is refused", async () => {
    for (const src of [
      "https://www.figma.com/embed?embed_host=folevi&url=https%3A%2F%2Fevil.example%2Fproto",
      "https://www.figma.com/community/file/123",
      "https://www.loom.com/login",
      "https://maps.google.com/url?q=https://evil.example",
      "https://evil.example/embed/dQw4w9WgXcQ",
      "javascript:alert(1)",
      "",
    ]) {
      const res = ask(src);
      expect(res.status, src).toBe(400);
      expect(await res.text(), src).not.toContain("<iframe");
    }
  });

  test("every provider's own player is framed as it is", async () => {
    for (const page of ["https://vimeo.com/76979871", "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184", "https://www.figma.com/design/AbCdEfGhIjKlMnOp/Trip-plan?node-id=1-2", "https://www.google.com/maps/place/Eiffel+Tower/@48.8584,2.2945,17z"]) {
      const player = embedFor(page)!.src;
      const html = await ask(player).text();
      expect(html, page).toContain(`<iframe src="${player.replace(/&/g, "&amp;")}"`);
    }
  });
});
