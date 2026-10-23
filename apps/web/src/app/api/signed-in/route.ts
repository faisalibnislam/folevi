import { signedInStatus } from "@/lib/auth/server";
import { signedInCors, signedInPreflight } from "@/lib/auth/signedInCheck";
import { APP_URL, MARKETING_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

const marketingOrigin = new URL(MARKETING_URL).origin;
const appOrigin = new URL(APP_URL).origin;

/** Whether this browser is signed in, for folevi.com's home page (lib/auth/signedInCheck.ts). Only `{ signedIn }`. */
export async function GET(request: Request) {
  const cors = signedInCors(request.headers.get("origin"), marketingOrigin, appOrigin);
  const headers = new Headers({ ...cors.headers, "content-type": "application/json" });
  if (!cors.allowed) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  const { signedIn, setCookies } = await signedInStatus(request);
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ signedIn }), { status: 200, headers });
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: signedInPreflight(request.headers.get("origin"), marketingOrigin, appOrigin) });
}
