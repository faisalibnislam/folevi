import { CheckSquare, FileDown, Folder, LayoutTemplate, Link2, Network, Paintbrush, PenTool, Share2, ShieldCheck, Users, WifiOff, type LucideIcon } from "lucide-react";
import { AiIcon } from "@/components/ai/AiIcon";

const ICONS: Record<string, LucideIcon> = {
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

/** The feature's icon on the site's tile (the rounded square beside section titles). */
export function FeatureIcon({ slug }: { slug: string }) {
  const Glyph = ICONS[slug];
  return <span className="mk-tile">{slug === "ai-notes" ? <AiIcon size={17} /> : Glyph ? <Glyph size={17} aria-hidden="true" /> : null}</span>;
}
