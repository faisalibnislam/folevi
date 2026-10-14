# Listing Folevi's MCP server

Folevi's MCP server runs at `https://app.folevi.com/mcp` (a Convex HTTP action behind the Next.js `/mcp`
route; `convex/mcpServer.ts`). Sign-in is OAuth 2.1 with dynamic client registration, so an app only needs
the address. People connect it as described on https://folevi.com/docs/connected-apps.

`server.json` describes it for the official MCP Registry (registry.modelcontextprotocol.io), which other
directories read from. To publish it (after the server is live in production):

1. Install the publisher: `brew install mcp-publisher`.
2. Check the file against the current schema: `mcp-publisher validate mcp/server.json` (update `$schema`
   if the registry has moved on).
3. Prove the folevi.com domain: `mcp-publisher login dns --domain folevi.com --private-key <key>` and add the
   TXT record it prints at Namecheap (the `com.folevi/` namespace comes from the domain).
4. Publish: `mcp-publisher publish mcp/server.json`. Bump `version` for each later change.

Directories that take submissions by form (Claude's connector directory, ChatGPT apps, Smithery, PulseMCP,
mcp.so) need the same three things: the address above, the docs page, and a short description such as the
one in `server.json`. Their review checks that OAuth sign-in works from a fresh account, that the consent
page names the permissions, and that tools have titles and read-only/destructive hints (they do:
`convex/lib/mcp/tools.ts`).
