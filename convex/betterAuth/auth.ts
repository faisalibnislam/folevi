import { createAuth } from "../auth";

// Static instance for the Better Auth CLI (`npx auth generate`). Not used at runtime.
export const auth = createAuth({} as never);
