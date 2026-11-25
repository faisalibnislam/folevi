// What this Folevi is, for the apps' "Your own server" (docs/self-hosting/CONTRACT.md §6): a self-hosted server
// says "folevi-server" with its name, addresses, sign-in methods and features; Folevi Cloud says "folevi-cloud".
// Public and readable from any origin, since an app or another site checks it before signing in.
import { wellKnownDocument } from "@/lib/server-edition/serverInfo";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await wellKnownDocument(), {
    headers: {
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-max-age": "86400" },
  });
}
