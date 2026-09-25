/// <reference types="vite/client" />
// All backend modules (and the generated API) for convex-test; test files and type declarations excluded.
export const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts", "!./tests/**"]);
