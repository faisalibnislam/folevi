// The bundled app shell's only page (FOLEVI_BUILD=shell). Hosts serve this index.html for every path that
// isn't a file (SPA fallback), and the client router (lib/app/router.tsx) takes it from there.
// SPIKE S1: renders the product as it is today plus a probe; WP1 replaces this with <ShellRoot/>.
import { ProductApp } from "@/components/app/ProductApp";
import { ShellProbe } from "../../spikes/s1-shell/ShellProbe";

export default function ShellPage() {
  return (
    <>
      <ShellProbe />
      <ProductApp />
    </>
  );
}
