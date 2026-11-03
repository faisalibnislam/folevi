// An image's description: the alt text a person wrote for it. Uploads used to take their file's name as alt
// ("IMG_2041", "Screenshot 2026-10-12 at 09.14.03", an opaque hash), which describes nothing and reads badly
// aloud, so a name like that counts as no description. Stored notes keep what they have; it's only not shown.

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?|svg)$/i;
/** Names cameras, phones and screenshot tools give files: a known prefix, then digits or a date. */
const DEVICE_NAME = /^(?:img|dsc[nf]?|dcim|pxl|mvimg|gopr|dji|scan|screenshot|screen shot|cleanshot|whatsapp image|signal)[\s_-]*[\d(]/i;
/** Words a file gets when it has no name of its own (a pasted image is "image.png"), maybe numbered. */
const PLACEHOLDER = /^(?:image|img|photo|pic|picture|untitled|unnamed|blob|download)(?:[\s_-]*\(?\d+\)?)?$/i;
/** A date or timestamp on its own ("2026-10-12 09.14.03", "20261012_091403"). */
const TIMESTAMP = /^\d{4}[-_.]?\d{2}[-_.]?\d{2}(?:[\sT_-]+[\d.:-]+)?(?:\s*\(\d+\))?$/;

/** True when `text` reads as a file's name rather than words someone wrote about the image. */
export function looksLikeFileName(text: string, fileName?: string | null): boolean {
  const t = text.trim();
  if (!t) return false;
  if (fileName) {
    const name = fileName.trim().toLowerCase();
    const lower = t.toLowerCase();
    if (lower === name || lower === name.replace(/\.[^.]+$/, "")) return true;
  }
  if (IMAGE_EXTENSION.test(t) || DEVICE_NAME.test(t) || PLACEHOLDER.test(t) || TIMESTAMP.test(t)) return true;
  // One long run with no spaces, made of letters, digits and separators, with a digit in it: a hash, an id,
  // or a name like "beach_trip_2024_03". People describing a picture write words with spaces.
  return t.length >= 12 && !/\s/.test(t) && /\d/.test(t) && /^[\w.-]+$/.test(t);
}

/** The image's description for its alt text, or "" when it has none (or only a file's name). */
export function imageDescription(alt: unknown, fileName?: string | null): string {
  const t = typeof alt === "string" ? alt.trim() : "";
  return t && !looksLikeFileName(t, fileName) ? t : "";
}
