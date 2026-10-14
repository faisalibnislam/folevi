import spec from "@/lib/api/openapi.json";

/** The REST API's description (OpenAPI 3.1), public and readable from any origin (API explorers, code generators). */
export function GET(): Response {
  return new Response(JSON.stringify(spec, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
