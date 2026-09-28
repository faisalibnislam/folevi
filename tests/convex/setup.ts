/// <reference types="vite/client" />
// All backend modules (and the generated API) for convex-test. Lives outside convex/ so it is never deployed.
// The locally installed Better Auth component (convex/betterAuth) is registered separately.
export const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts", "!../../convex/betterAuth/**"]);
export const authModules = import.meta.glob(["../../convex/betterAuth/**/*.ts", "../../convex/betterAuth/_generated/**/*.js", "!../../convex/betterAuth/**/*.d.ts"]);
