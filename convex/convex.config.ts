import { defineApp } from "convex/server";
import betterAuth from "./betterAuth/convex.config";

// Better Auth runs as an isolated Convex component (its own tables: users, sessions, accounts,
// verification tokens, TOTP secrets, backup codes, rate-limit counters, JWKS).
const app = defineApp();
app.use(betterAuth);

export default app;
