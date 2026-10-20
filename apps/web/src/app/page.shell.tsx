// The bundled app shell's only page (FOLEVI_BUILD=shell). Hosts serve this index.html for every path that
// isn't a file (SPA fallback), and the client router (lib/app/router.tsx) takes it from there.
import { ShellRoot } from "@/components/app/ShellRoot";

export default function ShellPage() {
  return <ShellRoot />;
}
