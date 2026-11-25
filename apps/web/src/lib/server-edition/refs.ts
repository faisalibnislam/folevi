// The Convex functions of the server edition and of Folevi Connect (docs/self-hosting/CONTRACT.md §7, §7.1), and
// the shapes the admin panel reads from them (secrets come back as `{set}`; `userId` is the profile id).
import type { FunctionArgs } from "convex/server";
import { api } from "@/lib/convex/api";

export type ServerRole = "owner" | "admin" | "member" | "guest";
/** The roles an invite or setRole can give (the owner changes only through transferOwnership). */
export type InvitableRole = Exclude<ServerRole, "owner">;

// ---------------------------------------------------------------- settings (CONTRACT §8)

/** A write-only secret as the backend reports it back. */
export type SecretState = { set: boolean };

export interface SmtpSettings {
  host: string;
  port: number;
  security: "tls" | "starttls" | "none";
  username?: string;
  password?: SecretState;
  from: string;
}

export interface ServerSettings {
  name: string;
  signUp: "invite" | "open" | "domains";
  allowedDomains: string[];
  signIn: { password: boolean; passkey: boolean; folevi: boolean; google: boolean; apple: boolean };
  google?: { clientId: string; clientSecret?: SecretState };
  publicLinks: boolean;
  defaultQuotaBytes?: number;
  email: { mode: "off" | "folevi" | "smtp"; smtp?: SmtpSettings };
  emailIn: { mode: "off" | "folevi" | "imap"; imap?: { host: string; port: number; username: string; password?: SecretState; folder: string } };
  ai: {
    mode: "off" | "folevi" | "gemini" | "openai";
    gemini?: { apiKey?: SecretState; model?: string; embeddingModel?: string };
    openai?: { baseUrl: string; apiKey?: SecretState; model: string; embeddingModel?: string };
    allowed: "everyone" | "admins";
    monthlyLimitPerPerson?: number;
  };
  push: { relay: boolean };
  covers: { mode: "off" | "folevi" | "unsplash"; unsplashKey?: SecretState };
  ownerUserId?: string;
}

export interface ServerPerson {
  userId: string;
  name: string;
  email: string;
  role: ServerRole;
  suspended: boolean;
  storageBytes: number;
  quotaBytes?: number | null;
  lastActiveAt: number | null;
  twoFactor: boolean;
}

export interface ServerInvite {
  inviteId: string;
  email?: string;
  role: ServerRole;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  state: "pending" | "used" | "accepted" | "revoked" | "expired";
}

export interface ServerOverview {
  people: number;
  storageBytes: number;
  notes: number;
  lastSignIns: { userId: string; name: string; at: number }[];
}

export interface LinkedServer {
  serverId: string;
  name: string;
  hostname: string;
  lanHostnames: string[];
  version: string;
  online: boolean;
  role: "owner" | "member";
}

export const serverRefs = { info: api.server.info, claimOwner: api.server.claimOwner };
export const serverInviteRefs = { preview: api.serverInvites.preview, accept: api.serverInvites.accept };
export const serverAdminRefs = api.serverAdmin;
/** Folevi Cloud only (CONTRACT §7, Connect). */
export const connectRefs = { myServers: api.connect.myServers, approveLink: api.connect.approveLink };

/** What serverAdmin:updateSettings takes as `patch` (CONTRACT §7.1: a secret string sets, null clears, left out keeps). */
export type ServerSettingsPatch = FunctionArgs<typeof api.serverAdmin.updateSettings>["patch"];
