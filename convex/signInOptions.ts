// What the sign-in and sign-up pages offer besides email and password (apps/web lib/auth/signInOptions.ts).
import { query } from "./_generated/server";
import { googleSignIn } from "./auth";

/** { google }: whether "Continue with Google" is set up on this deployment (its keys are in the environment). */
export const options = query({
  args: {},
  handler: async () => ({ google: googleSignIn() !== null }),
});
