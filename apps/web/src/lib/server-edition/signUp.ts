// Folevi Server's sign-up from the web (setup page, invites): create the account, then sign it in.
//
// The backend's Better Auth keeps `autoSignIn: false` and `requireEmailVerification: true` for both editions, so a
// sign-up never returns a session, even on a server with email off where the account starts verified
// (CONTRACT §7.1 item 6). Without this second step the setup page and invite links waited forever for a sign-in.
import { authClient } from "@/lib/auth/client";

type AuthError = { code?: string; message?: string; status?: number } | null;

export interface ServerSignUpInput {
  name: string;
  email: string;
  password: string;
  callbackURL: string;
  /** A `/join/<token>` invite, or the setup code for the first account, sent as `x-folevi-invite` (CONTRACT §7.1 item 5). */
  inviteToken?: string;
}

/**
 * Creates the account and, when the server didn't sign it in (email off: the account is already verified), signs
 * in with the same password. Returns the first error, or null when the person is signed in (or, with email on,
 * when a confirmation link is on its way: `needsConfirmation`).
 */
export async function serverSignUp(input: ServerSignUpInput): Promise<{ error: AuthError; needsConfirmation: boolean }> {
  const { data, error } = await authClient.signUp.email({
    name: input.name,
    email: input.email,
    password: input.password,
    callbackURL: input.callbackURL,
    ...(input.inviteToken ? { fetchOptions: { headers: { "x-folevi-invite": input.inviteToken } } } : {}),
  });
  if (error) return { error, needsConfirmation: false };
  if (data && "token" in data && data.token) return { error: null, needsConfirmation: false };
  if (data && "user" in data && data.user && data.user.emailVerified === false) return { error: null, needsConfirmation: true };
  const signIn = await authClient.signIn.email({ email: input.email, password: input.password });
  return { error: signIn.error ?? null, needsConfirmation: false };
}
