import type { Metadata } from "next";
import { FoleviLogo } from "@/components/brand/FoleviMark";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const marketing = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
  // ui-neutral-chrome: the same neutral colours as the app (white / near-black), from the first paint.
  return (
    <div className="ui-canvas ui-neutral-chrome grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <a href={marketing} className="mb-6 inline-flex items-center gap-2 text-ink" aria-label="Folevi home">
          <FoleviLogo height={28} title={null} />
        </a>
        <main id="main" className="relative">
          <div aria-hidden className="absolute inset-0 translate-x-2 translate-y-2 ui-card rounded-[10px]" />
          <div className="relative ui-card rounded-[10px] p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
