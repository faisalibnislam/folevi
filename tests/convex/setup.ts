/// <reference types="vite/client" />
// All backend modules (and the generated API) for convex-test. Lives outside convex/ so it is never deployed.
export const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
