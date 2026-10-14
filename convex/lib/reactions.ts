// Comment reactions: six plain marks, drawn as monochrome icons by the clients (never emoji). The order here
// is the order they're shown in.
import { v } from "convex/values";

export const REACTION_KINDS = ["thumbsUp", "heart", "check", "eyes", "laugh", "idea"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const vReactionKind = v.union(...REACTION_KINDS.map((k) => v.literal(k)));

/** How many other people a reaction names for "who reacted" (the rest are counted). */
export const REACTION_NAMES_SHOWN = 10;
