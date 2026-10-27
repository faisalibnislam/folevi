"use client";

import { useState } from "react";
import { Download, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Link2, type LucideIcon } from "lucide-react";
import { formatBytes } from "@/lib/format";

/*
 * Bookmark and attachment cards for read-only pages (shared links, version history, diffs): the editor's
 * cards (editor/NodeViews.tsx BookmarkView and FileView) without their editing controls. Each card is one
 * link, so it is one stop for the keyboard and one name for a screen reader.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ReadOnlyBookmark({
  href,
  title,
  description,
  siteName,
  image,
  icon,
}: {
  /** The bookmark's address, already checked (sanitizeHref); null when it isn't a usable one. */
  href: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
  icon: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const host = href ? hostOf(href) : "";
  const name = title || host || "Bookmark";
  const showImage = Boolean(image) && !imageFailed;
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-4">
        {icon && !iconFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setIconFailed(true)} className="mb-1 h-6 w-6 flex-none rounded-tiny object-contain" />
        ) : (
          <Link2 size={18} className="mb-1 text-muted" aria-hidden />
        )}
        <span className="block truncate font-semibold text-ink">{name}</span>
        {description ? <span className="line-clamp-2 block text-subheadline leading-snug text-muted">{description}</span> : null}
        {host ? (
          <span className="block truncate text-footnote text-faint">
            {siteName ? `${siteName} · ` : ""}
            {host}
          </span>
        ) : null}
      </span>
      {showImage ? (
        // The standard social image shape (1.91:1), as in the editor's card.
        <span className="relative my-3 mr-3 hidden aspect-[1.91/1] w-[34%] max-w-[260px] flex-none self-center overflow-hidden rounded-chip bg-sunken shadow-[inset_0_0_0_1px_var(--color-line)] sm:block" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image!} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        </span>
      ) : null}
    </>
  );
  const card = "my-2 flex min-h-[7.5rem] items-stretch overflow-hidden ui-card rounded-control no-underline break-inside-avoid";
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={`${card} transition-shadow hover:shadow-[var(--shadow-pop)]`} data-bookmark="">
      {body}
    </a>
  ) : (
    <div className={card} data-bookmark="">
      {body}
    </div>
  );
}

/** A file's icon, from its type (or, without one, its name's extension). */
export function fileIcon(mimeType: string | null, name: string | null): LucideIcon {
  const type = (mimeType ?? "").toLowerCase();
  const ext = (name ?? "").toLowerCase().split(".").pop() ?? "";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "avif"].includes(ext)) return FileImage;
  if (type.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(ext)) return FileVideo;
  if (type.startsWith("audio/") || ["mp3", "m4a", "wav", "ogg", "flac", "aac"].includes(ext)) return FileAudio;
  if (/zip|compressed|tar|gzip|rar|7z/.test(type) || ["zip", "gz", "tar", "rar", "7z"].includes(ext)) return FileArchive;
  if (/spreadsheet|excel|csv/.test(type) || ["csv", "xls", "xlsx", "numbers", "ods"].includes(ext)) return FileSpreadsheet;
  if (type.startsWith("text/") || /pdf|word|document|rtf/.test(type) || ["pdf", "doc", "docx", "txt", "md", "rtf", "pages", "odt"].includes(ext)) return FileText;
  return File;
}

export function ReadOnlyFile({ href, name, size, mimeType }: { href: string | null; name: string | null; size: number | null; mimeType: string | null }) {
  const Icon = fileIcon(mimeType, name);
  const label = name || "Attachment";
  const details = [size ? formatBytes(size) : null, href ? null : "Not available on this page"].filter(Boolean).join(" · ");
  const body = (
    <>
      <Icon size={20} className="flex-none text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-subheadline font-medium text-ink">{label}</span>
        {details ? <span className="block text-footnote text-muted">{details}</span> : null}
      </span>
      {href ? (
        <span className="inline-flex h-8 flex-none items-center gap-1.5 rounded-chip border border-line px-2.5 text-footnote text-ink print:hidden" aria-hidden>
          <Download size={14} /> Download
        </span>
      ) : null}
    </>
  );
  const card = "my-1.5 flex items-center gap-3 ui-card rounded-control px-3 py-2.5 no-underline break-inside-avoid";
  return href ? (
    <a href={href} download={name ?? true} className={`${card} transition-shadow hover:shadow-[var(--shadow-pop)]`} aria-label={`Download ${label}${size ? `, ${formatBytes(size)}` : ""}`} data-file="">
      {body}
    </a>
  ) : (
    <div className={card} data-file="">
      {body}
    </div>
  );
}
