import { describe, expect, it } from "vitest";
import { entryMap, type BundleEntry } from "@/components/doc/importBundle";
import { htmlToMarkdown } from "@/lib/import/htmlToMarkdown";
import { md5Hex } from "@/lib/import/md5";
import { csvToMarkdown, evernoteDocs, isNotionExport, notionDocs, parseCsv } from "@/lib/import/sources";

const text = (s: string) => new Blob([s], { type: "text/plain" });
const entry = (path: string, s: string): BundleEntry => ({ path, blob: text(s) });

describe("HTML to Markdown", () => {
  it("keeps headings, emphasis, links, lists, quotes, code and tables", () => {
    const { markdown } = htmlToMarkdown(
      `<h1>Trip</h1><p>Pack <b>light</b> and <i>early</i>, see <a href="https://example.com/a b">the list</a>.</p>
       <ul><li>Passport<ul><li>Copy</li></ul></li><li>Charger</li></ul><ol><li>One</li><li>Two</li></ol>
       <blockquote><p>Travel well</p></blockquote><pre>let x = 1;</pre>
       <table><tr><th>Day</th><th>City</th></tr><tr><td>1</td><td>Rome</td></tr></table>`,
    );
    expect(markdown).toBe(
      [
        "# Trip",
        "Pack **light** and _early_, see [the list](https://example.com/a%20b).",
        "- Passport\n  - Copy\n- Charger",
        "1. One\n2. Two",
        "> Travel well",
        "```\nlet x = 1;\n```",
        "| Day | City |\n| --- | --- |\n| 1 | Rome |",
      ].join("\n\n"),
    );
  });

  it("turns Evernote's to-dos into to-dos, both old and new styles, and drops scripts", () => {
    const { markdown } = htmlToMarkdown(
      `<en-note><div><en-todo checked="true"/>Buy milk</div><div><en-todo/>Call Sam</div>
       <ul style="--en-todo:true;"><li style="--en-checked:true;">Book</li><li style="--en-checked:false;">Pay</li></ul><script>alert(1)</script></en-note>`,
    );
    expect(markdown).toBe("- [x] Buy milk\n\n- [ ] Call Sam\n\n- [x] Book\n- [ ] Pay");
  });

  it("escapes Markdown characters in plain text", () => {
    expect(htmlToMarkdown("<p>2 * 3 = [six]_ok</p>").markdown).toBe("2 \\* 3 = \\[six\\]\\_ok");
  });
});

describe("CSV", () => {
  it("parses quotes and newlines inside them, and makes a table", () => {
    expect(parseCsv('Name,Note\n"Sam, Jr.","said ""hi""\nthen left"\n')).toEqual([
      ["Name", "Note"],
      ["Sam, Jr.", 'said "hi"\nthen left'],
    ]);
    const warnings: { message: string }[] = [];
    expect(csvToMarkdown("A,B\n1,2|3\n", warnings)).toBe("| A | B |\n| --- | --- |\n| 1 | 2\\|3 |");
    expect(warnings).toEqual([]);
  });
});

describe("MD5", () => {
  it("matches the standard test vectors", () => {
    expect(md5Hex(new TextEncoder().encode(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex(new TextEncoder().encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex(new TextEncoder().encode("The quick brown fox jumps over the lazy dog"))).toBe("9e107d9d372bb6826bd81d3542a419d6");
  });
});

describe("Notion export", () => {
  const ID = (n: number) => String(n).repeat(32).slice(0, 32).replace(/[^0-9a-f]/g, "a");
  const entries = [
    entry(`Home ${ID(1)}.md`, `# Home\n\nSee [Projects](Home%20${ID(1)}/Projects%20${ID(2)}.md) and [Tasks](Home%20${ID(1)}/Tasks%20${ID(3)}.csv).`),
    entry(`Home ${ID(1)}/Projects ${ID(2)}.md`, "# Projects\n\nBack [home](../Home%20" + ID(1) + ".md)."),
    entry(`Home ${ID(1)}/Tasks ${ID(3)}.csv`, "Name,Done\nShip,No\n"),
    entry(`Home ${ID(1)}/Tasks ${ID(3)}_all.csv`, "Name,Done\nShip,No\nPlan,Yes\n"),
  ];

  it("is recognised by its ids", () => {
    expect(isNotionExport(entries)).toBe(true);
    expect(isNotionExport([entry("notes/plan.md", "x")])).toBe(false);
  });

  it("nests pages, keeps the full database, and links pages to each other", async () => {
    const docs = await notionDocs(entries, entryMap(entries));
    expect(docs.map((d) => d.name)).toEqual(["Home (page)", "Projects (page)", "Tasks (database)"]);
    const [home, projects, tasks] = docs as [(typeof docs)[0], (typeof docs)[0], (typeof docs)[0]];
    expect(projects.parentPath).toBe(home.path);
    expect(tasks.parentPath).toBe(home.path);
    expect(tasks.content).toContain("| Plan | Yes |");
    expect(home.links).toEqual({ [`Home%20${ID(1)}/Projects%20${ID(2)}.md`]: projects.publicId, [`Home%20${ID(1)}/Tasks%20${ID(3)}.csv`]: tasks.publicId });
    expect(projects.links).toEqual({ [`../Home%20${ID(1)}.md`]: home.publicId });
  });
});

describe("Evernote export", () => {
  it("reads notes, their images (matched by MD5) and tags", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const b64 = btoa(String.fromCharCode(...png));
    const hash = md5Hex(png);
    const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export><note><title>Garden</title>
<content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>Plant <b>tomatoes</b></div><en-media hash="${hash}" type="image/png"/></en-note>]]></content>
<tag>home</tag><resource><data encoding="base64">${b64}</data><mime>image/png</mime><resource-attributes><file-name>plot.png</file-name></resource-attributes></resource>
</note></en-export>`;
    const file = new File([enex], "Home notebook.enex");
    const [doc] = await evernoteDocs(file);
    expect(doc).toMatchObject({ folder: "Home notebook", filename: "Garden.md" });
    expect(doc!.content).toBe(`# Garden\n\nPlant **tomatoes**\n\n![](evernote:${hash})`);
    expect(doc!.images.get(`evernote:${hash}`)).toMatchObject({ filename: "plot.png", mime: "image/png" });
    expect(doc!.warnings).toEqual([{ message: "Tags weren’t imported: home" }]);
  });

  it("refuses something that isn't an export", async () => {
    await expect(evernoteDocs(new File(["<html></html>"], "x.enex"))).rejects.toThrow(/isn’t an Evernote export/);
  });
});
