import {
  BookOpen,
  Briefcase,
  Bug,
  CalendarCheck,
  CalendarRange,
  ChefHat,
  ClipboardList,
  Compass,
  Dumbbell,
  FileText,
  FlaskConical,
  GraduationCap,
  Heart,
  History,
  Lightbulb,
  MessagesSquare,
  PartyPopper,
  PenLine,
  Plane,
  RefreshCw,
  Scale,
  Sun,
  Target,
  Timer,
  UserRoundSearch,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Outlined icons for built-in templates, by the name stored in convex/lib/templates.ts. */
const ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  briefcase: Briefcase,
  bug: Bug,
  "calendar-check": CalendarCheck,
  "calendar-range": CalendarRange,
  "chef-hat": ChefHat,
  "clipboard-list": ClipboardList,
  compass: Compass,
  dumbbell: Dumbbell,
  "flask-conical": FlaskConical,
  "graduation-cap": GraduationCap,
  heart: Heart,
  history: History,
  lightbulb: Lightbulb,
  "messages-square": MessagesSquare,
  "party-popper": PartyPopper,
  "pen-line": PenLine,
  plane: Plane,
  "refresh-cw": RefreshCw,
  scale: Scale,
  sun: Sun,
  target: Target,
  timer: Timer,
  "user-round-search": UserRoundSearch,
  users: Users,
  wallet: Wallet,
};

/** Unknown names (and anything older, like an emoji) fall back to a plain page outline. */
export function TemplateIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const Icon = ICONS[name] ?? FileText;
  return <Icon size={size} strokeWidth={1.75} aria-hidden className={className} />;
}

/** Soft pastel tints, one per template (by name), so the gallery reads at a glance. `hue` is the ink colour. */
const TINTS = ["#e0607e", "#e8844a", "#d6a21e", "#6fa83a", "#2fa58a", "#3a9cc9", "#5b7fe0", "#8a6ee0", "#c465c9", "#d9738f"];
const TINT_OF: Record<string, number> = Object.fromEntries(Object.keys(ICONS).map((k, i) => [k, (i * 3) % TINTS.length]));

/** The icon on a pastel tile (template gallery, admin configuration). */
export function TemplateTile({ name, size = 36, iconSize = 18, className = "" }: { name: string; size?: number; iconSize?: number; className?: string }) {
  const hue = TINTS[TINT_OF[name] ?? 0]!;
  return (
    <span
      aria-hidden
      className={`grid flex-none place-items-center rounded-control ${className}`}
      style={{ width: size, height: size, background: `color-mix(in oklab, ${hue} 17%, transparent)`, color: `color-mix(in oklab, ${hue} 78%, var(--color-heading))` }}
    >
      <TemplateIcon name={name} size={iconSize} />
    </span>
  );
}
