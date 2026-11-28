import type { ReactNode } from "react";
import { ButtonLink, cx } from "../ui";
import { BetaBadge } from "../Beta";
import { CopyButton } from "./CopyButton";
import { formatSize, serverFile, type ServerArch, type ServerManifest, type ServerPlatform } from "./manifest";

/** The chips Folevi Server is built for, as people know them. */
export const ARCH_LABELS: Record<ServerArch, string> = { x86_64: "Intel or AMD", aarch64: "ARM" };

/** Stands in for a download or address the manifest doesn't have yet. Not a control, so it has no hover. */
export function ComingSoon({ className }: { className?: string }) {
  return (
    <span aria-disabled="true" className={cx("mk-chip flex-none whitespace-nowrap text-muted", className)}>
      Coming soon
    </span>
  );
}

/** A value to paste somewhere (a command, an address), in a code well with a copy button. */
export function CopyLine({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <div className={cx("mk-panel flex items-center gap-2 py-1.5 pl-4 pr-1.5", className)}>
      <code className="min-w-0 flex-1 py-1 font-mono text-[13px] text-(--color-heading) [overflow-wrap:anywhere]">{value}</code>
      <CopyButton text={value} label={label} />
    </div>
  );
}

/**
 * One download for one chip: the file's name, size and SHA-256 with a Download button, or "Coming soon" when the
 * manifest has no file for it.
 */
export function DownloadRow({ manifest, platform, arch, product, kind }: { manifest: ServerManifest | null; platform: ServerPlatform; arch: ServerArch; product: string; /** Shown before the chip (".deb"). */ kind?: string }) {
  const file = serverFile(manifest, platform, arch);
  const label = kind ? `${kind} for ${ARCH_LABELS[arch]}` : ARCH_LABELS[arch];
  return (
    <div className="mk-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-(--color-heading)">
            {label} <span className="font-normal text-muted">({arch})</span>
            {/* Folevi Server is in Early Beta (lib/beta.ts), so every download says so. */}
            <BetaBadge className="ml-2 align-middle" />
          </p>
          {file ? (
            <p className="mt-0.5 text-[13px] text-muted [overflow-wrap:anywhere]">
              {file.name}, <span className="whitespace-nowrap">{formatSize(file.sizeBytes)}</span>
            </p>
          ) : null}
        </div>
        {file ? (
          <ButtonLink href={file.url} size="sm" variant="secondary">
            Download<span className="sr-only"> {product} for {label}</span>
          </ButtonLink>
        ) : (
          <ComingSoon />
        )}
      </div>
      {file ? (
        <div className="mt-3 flex items-center gap-2 border-t mk-hair pt-2.5">
          <span className="flex-none text-[12px] font-medium text-muted">SHA-256</span>
          <code title={file.sha256} className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
            {file.sha256}
          </code>
          <CopyButton text={file.sha256} label={`SHA-256 of ${file.name}`} />
        </div>
      ) : null}
    </div>
  );
}

/** Both chips' downloads for one platform. */
export function ChipDownloads({ manifest, platform, product, className }: { manifest: ServerManifest | null; platform: ServerPlatform; product: string; className?: string }) {
  return (
    <div className={cx("grid min-w-0 gap-3 [&>*]:min-w-0", className)}>
      <DownloadRow manifest={manifest} platform={platform} arch="x86_64" product={product} />
      <DownloadRow manifest={manifest} platform={platform} arch="aarch64" product={product} />
    </div>
  );
}

/** "Which do I have?": where the NAS names its processor, and which names mean which chip. */
export function WhichChip({ where }: { where: ReactNode }) {
  return (
    <details className="group mt-4 text-[14px]">
      <summary className="-ml-2 inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-chip px-2 font-medium text-(--color-heading) transition-colors duration-150 hover:bg-(--color-surface-sunken) [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-150 group-open:rotate-90">
          <path d="m8 5 5 5-5 5" />
        </svg>
        Which do I have?
      </summary>
      <div className="mt-2 max-w-[56ch] space-y-2 leading-relaxed text-muted">
        <p>{where}</p>
        <p>
          Intel, AMD, Celeron, Pentium, Atom, Xeon and Ryzen mean Intel or AMD. Realtek, Annapurna Labs and Cortex mean
          ARM. Older 32-bit ARM models can’t run Folevi Server.
        </p>
      </div>
    </details>
  );
}

/** Numbered steps, for the stores where Folevi is installed from a catalog (no file to download). */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2.5 text-[15px]">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 leading-snug text-ink">
          <span aria-hidden="true" className="mk-tile h-6 w-6 text-[12px] font-semibold">
            {i + 1}
          </span>
          <span className="min-w-0 pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/** A platform name inside a card: a small heading with what it runs on. */
export function PlatformTitle({ name, detail }: { name: string; detail: string }) {
  return (
    <h3 className="mk-h3 text-[18px]">
      {name} <span className="text-[15px] font-normal text-muted">{detail}</span>
    </h3>
  );
}
