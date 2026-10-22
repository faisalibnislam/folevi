// What the sign-in and sign-up pages offer besides email and password (apps/web lib/auth/signInOptions.ts).
import { query } from "./_generated/server";
import { appleSignIn, googleSignIn } from "./auth";

/** { google, apple }: whether "Continue with Google" and "Continue with Apple" are set up on this deployment (their keys are in the environment). */
export const options = query({
  args: {},
  handler: async () => ({ google: googleSignIn() !== null, apple: appleSignIn() !== null }),
});
