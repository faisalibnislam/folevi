"use client";

// A photo of paper sticky notes, made ready for Foli AI on the device: turned upright (the browser applies
// the photo's orientation), made at most 2048 px on its long side and saved as a JPEG, so what's sent is a
// few hundred kilobytes rather than a phone camera's 5 to 12 MB. Nothing heavy runs on our servers.

const MAX_SIDE = 2048;
const QUALITY = 0.86;
/** Photos this large are refused before anything is read (a camera's RAW file, a huge scan). */
const MAX_BYTES = 40 * 1024 * 1024;

export interface PhotoForAi {
  mimeType: "image/jpeg";
  /** Base64, without the data: prefix. */
  data: string;
}

/** A photo file as a smaller JPEG for Foli AI. Throws a person-readable error when it can't be read. */
export async function photoForAi(file: File): Promise<PhotoForAi> {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error("Choose a photo (JPEG, PNG, WebP or HEIC).");
  if (file.size > MAX_BYTES) throw new Error("That photo is too large. Try a smaller one.");
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Safari before 17 can't make a bitmap from some files: an image element reads them.
    bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("This photo can't be read here. Try a JPEG or PNG."));
      };
      img.src = url;
    });
  }
  const w = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
  if (!w || !h) throw new Error("This photo can't be read here. Try a JPEG or PNG.");
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device can't prepare the photo.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ("close" in bitmap) bitmap.close();
  const url = canvas.toDataURL("image/jpeg", QUALITY);
  const data = url.slice(url.indexOf(",") + 1);
  if (!data) throw new Error("This device can't prepare the photo.");
  return { mimeType: "image/jpeg", data };
}
