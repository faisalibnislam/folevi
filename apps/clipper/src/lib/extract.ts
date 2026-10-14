// Reading the page from the extension side: inject the bundled extractor (extractor.js) into the tab, then
// call it. Works in the tab the person clipped from, which activeTab opens up when they click the toolbar
// button or the context menu; browser pages (the new tab page, settings, extension stores) can't be read.
import type { Extracted, ExtractMode } from "./messages";

export class CantReadPage extends Error {
  constructor() {
    super("Folevi can't clip this page. Browser pages and extension stores can't be read by extensions.");
    this.name = "CantReadPage";
  }
}

export async function extractFromTab(tabId: number, mode: ExtractMode, linkUrl?: string): Promise<Extracted> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["extractor.js"] });
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (m: ExtractMode, link: string) => (globalThis as unknown as { __foleviExtract: (m: ExtractMode, link?: string) => Extracted }).__foleviExtract(m, link),
      args: [mode, linkUrl ?? ""],
    });
    if (!first?.result) throw new CantReadPage();
    return first.result as Extracted;
  } catch (e) {
    if (e instanceof CantReadPage) throw e;
    throw new CantReadPage();
  }
}
