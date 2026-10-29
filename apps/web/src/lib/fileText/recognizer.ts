"use client";
// Reading the text in an image on this device, for search (lib/fileText/indexer.ts): Apple's Vision in the
// iPhone and iPad app (FoleviNative.recognizeText) and in the Mac app (window.foleviDesktop.recognizeText, a
// small helper that ships with it). A browser has none: there, Foli AI can read images when asked
// (fileText.readImage). Nothing here sends anything anywhere.
import { nativeApp } from "@/lib/nativeApp";
import { desktop } from "@/lib/desktop";
import { TEST_HOOKS } from "@/lib/testHooks";

export type RecognizeKind = "image" | "handwriting";

export interface DeviceRecognizer {
  /** Where the recogniser runs (what Settings says). */
  where: "iphone" | "mac" | "test";
  recognize(image: Blob, kind: RecognizeKind): Promise<string>;
}

/**
 * Development and end-to-end tests only: a stand-in recogniser the page can be given (it answers with the
 * text for an image), so the path from an image to search runs without a device. Never in production.
 */
type TestRecognizer = (input: { kind: RecognizeKind; type: string; size: number }) => string | Promise<string>;
declare global {
  interface Window {
    __foleviTestRecognizer?: TestRecognizer;
  }
}

const base64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The recogniser on this device, or null in a browser (and in apps built before they had one). */
export function deviceRecognizer(): DeviceRecognizer | null {
  if (typeof window === "undefined") return null;
  if (TEST_HOOKS && typeof window.__foleviTestRecognizer === "function") {
    const test = window.__foleviTestRecognizer;
    return { where: "test", recognize: async (image, kind) => String((await test({ kind, type: image.type, size: image.size })) ?? "") };
  }
  const ios = nativeApp();
  if (ios?.recognizeText) {
    const read = ios.recognizeText.bind(ios);
    return {
      where: "iphone",
      recognize: async (image, kind) => (await read({ data: await base64(image), type: image.type, handwriting: kind === "handwriting" }))?.text ?? "",
    };
  }
  const mac = desktop();
  if (mac?.recognizeText) {
    const read = mac.recognizeText.bind(mac);
    return { where: "mac", recognize: async (image, kind) => (await read(new Uint8Array(await image.arrayBuffer()), kind === "handwriting"))?.text ?? "" };
  }
  return null;
}
