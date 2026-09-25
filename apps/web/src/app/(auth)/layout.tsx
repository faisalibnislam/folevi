import type { Metadata } from "next";
import { FoleviMark } from "@/components/brand/FoleviMark";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const marketing = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://folevi.com";
  return (
    <div className="folio-lines grid min-h-dvh place-items-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <a href={marketing} className="mb-6 inline-flex items-center gap-2 text-ink" aria-label="Folevi home">
          <FoleviMark size={26} accent="var(--color-accent)" />
          <span className="font-display text-2xl">Folevi</span>
        </a>
        <main id="main" className="relative">
          <div aria-hidden className="absolute inset-0 translate-x-2 translate-y-2 rounded-[14px] border border-line bg-surface" />
          <div className="relative rounded-[14px] border border-line bg-raised p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
