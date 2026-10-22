// The part of Vite's import.meta the harness uses (vite itself isn't a root dependency, so its client
// types aren't resolvable from here). Only `tsc -p tests/parity` reads this.
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], opts: { eager: true; import?: string; query?: string }): Record<string, T>;
  glob<T = unknown>(pattern: string | string[], opts?: { eager?: false; import?: string; query?: string }): Record<string, () => Promise<T>>;
}

// `?raw` imports (drivers/androidHost.ts reads the Android app's bridge script as text).
declare module "*?raw" {
  const text: string;
  export default text;
}
