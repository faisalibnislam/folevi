import { CalendarDays, CheckSquare, FileDown, Folder, History, LayoutTemplate, Link2, MessageSquare, Mic, Network, Search, SquareSlash, Paintbrush, PenTool, Share2, ShieldCheck, Users, WifiOff, type LucideIcon } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";

const ICONS: Record<string, LucideIcon> = {
  "audio-recordings": Mic,
  blocks: SquareSlash,
  search: Search,
  calendar: CalendarDays,
  comments: MessageSquare,
  "version-history": History,
  "offline-notes": WifiOff,
  tasks: CheckSquare,
  "linked-notes": Link2,
  folders: Folder,
  flowcharts: Network,
  whiteboard: PenTool,
  "note-styles": Paintbrush,
  sharing: Share2,
  "team-workspaces": Users,
  templates: LayoutTemplate,
  "import-and-export": FileDown,
  "security-and-privacy": ShieldCheck,
};

/** The feature's icon on its own (the site's sidebar lists a few features with it). */
export function FeatureGlyph({ slug, size = 17, className }: { slug: string; size?: number; className?: string }) {
  const Glyph = ICONS[slug];
  return slug === "ai-notes" ? <AiIcon size={size} className={className} /> : Glyph ? <Glyph size={size} aria-hidden="true" className={className} /> : null;
}

/** The feature's icon on the site's tile (the rounded square beside section titles). */
export function FeatureIcon({ slug }: { slug: string }) {
  return (
    <span className="mk-tile">
      <FeatureGlyph slug={slug} />
    </span>
  );
}
