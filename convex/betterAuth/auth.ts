import { createAuth } from "../auth";

// Static instance for the Better Auth CLI (`npx auth generate`) — not used at runtime.
export const auth = createAuth({} as never);
