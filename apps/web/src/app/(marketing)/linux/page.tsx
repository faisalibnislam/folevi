import Link from "next/link";
import { ComingSoonPlatform } from "@/components/marketing/ComingSoonPlatform";
import { pageMetadata } from "@/components/marketing/seo";
import { SectionHeading } from "@/components/marketing/ui";

// Folevi for Linux is paused (owner, 2026-11-28): the page stays, says Coming soon and offers no download, and the
// app's Beta tag is gone. The app (apps/desktop, packaging/linux) and its release scripts are kept. Folevi Server's
// .deb, .rpm and install command are a different product and stay on /server. Out of the sitemap and search
// results until the app is back.

export const metadata = pageMetadata({
  title: "Folevi for Linux: coming soon",
  description: "Folevi for Linux is coming soon. Until then, use the Folevi web app in any browser on your Linux PC. To host Folevi on a Linux server, use Folevi Server.",
  path: "/linux",
  noindex: true,
});

export default function LinuxPage() {
  return (
    <ComingSoonPlatform
      name="Linux"
      device="Linux PC"
      extra={
        <SectionHeading
          id="server-title"
          eyebrow="Running a Linux server?"
          title="Folevi Server runs there today."
          lede={
            <>
              Folevi Server (Early Beta) is the self-hosted Folevi, with a .deb, an .rpm, a one-line install command and a container
              image. <Link href="/server#linux" className="underline underline-offset-2">Set up Folevi Server</Link>.
            </>
          }
        />
      }
    />
  );
}
