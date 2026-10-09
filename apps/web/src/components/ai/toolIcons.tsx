import { CircleHelp, Glasses, Grid3x3, Hourglass, Layers, LayoutGrid, MessageCircleQuestion, Network, Scale, ShieldAlert, Shuffle, Users } from "lucide-react";
import type { AiTask } from "./useAi";

/** Icons for the meeting, study and "Think it through" tools (useAi.ts AI_TOOLS). */
export const TOOL_ICONS: Partial<Record<AiTask, React.ReactNode>> = {
  meetingSummary: <Users size={15} />,
  flashcards: <Layers size={15} />,
  quiz: <CircleHelp size={15} />,
  prosCons: <Scale size={15} />,
  decisionMatrix: <Grid3x3 size={15} />,
  swot: <LayoutGrid size={15} />,
  risks: <ShieldAlert size={15} />,
  premortem: <Hourglass size={15} />,
  mindMap: <Network size={15} />,
  howMightWe: <MessageCircleQuestion size={15} />,
  scamper: <Shuffle size={15} />,
  sixHats: <Glasses size={15} />,
};
