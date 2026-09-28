// Host configuration. The same Next.js app serves the marketing site (folevi.com) and the product
// (app.folevi.com, including /admin). Locally: http://localhost:3000 and http://app.localhost:3000.
export const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.folevi.com";

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export const MARKETING_HOST = hostOf(MARKETING_URL);
export const APP_HOST = hostOf(APP_URL);
