import { appOrigin, METADATA_HEADERS } from "@/lib/server/mcp";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for Folevi's MCP server: which authorization server
 * issues its tokens and what they can be for. Apps find it from the 401 the MCP endpoint answers with
 * (WWW-Authenticate resource_metadata), at /.well-known/oauth-protected-resource/mcp.
 */
export function GET() {
  const origin = appOrigin();
  return Response.json(
    {
      resource: `${origin}/mcp`,
      authorization_servers: [`${origin}/api/auth`],
      scopes_supported: ["notes:read", "notes:write", "tasks:read", "tasks:write"],
      bearer_methods_supported: ["header"],
      resource_name: "Folevi",
      resource_documentation: "https://folevi.com/docs/connected-apps",
    },
    { headers: METADATA_HEADERS },
  );
}
