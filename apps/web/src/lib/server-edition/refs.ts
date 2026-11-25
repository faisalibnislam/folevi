// The Convex functions of the server edition and of Folevi Connect (docs/self-hosting/CONTRACT.md §7), named by
// string. The backend workstream adds them to convex/; until convex/_generated/api has them, these references
// keep the web build typechecking either way. Once generated, they can move to `api.server.info` and friends
// (same names, same shapes).
import { makeFunctionReference } from "convex/server";
import type { ServerInfoCore } from "./info";

export type ServerRole = "owner" | "admin" | "member" | "guest";

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

/**
 * What `serverAdmin:updateSettings` takes: any part of the settings, with secrets as plain strings (write-only;
 * left out, a stored secret stays as it is).
 */
export type ServerSettingsPatch = {
  name?: string;
  signUp?: ServerSettings["signUp"];
  allowedDomains?: string[];
  signIn?: Partial<ServerSettings["signIn"]>;
  google?: { clientId: string; clientSecret?: string };
  publicLinks?: boolean;
  defaultQuotaBytes?: number | null;
  email?: { mode: ServerSettings["email"]["mode"]; smtp?: Omit<SmtpSettings, "password"> & { password?: string } };
  emailIn?: { mode: ServerSettings["emailIn"]["mode"]; imap?: { host: string; port: number; username: string; password?: string; folder: string } };
  ai?: {
    mode: ServerSettings["ai"]["mode"];
    gemini?: { apiKey?: string; model?: string; embeddingModel?: string };
    openai?: { baseUrl: string; apiKey?: string; model: string; embeddingModel?: string };
    allowed?: ServerSettings["ai"]["allowed"];
    monthlyLimitPerPerson?: number | null;
  };
  push?: { relay: boolean };
  covers?: { mode: ServerSettings["covers"]["mode"]; unsplashKey?: string };
};

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
  token?: string;
  id?: string;
  email?: string | null;
  role: ServerRole;
  url?: string;
  expiresAt: number;
  createdAt?: number;
  invitedBy?: string;
}

export interface ServerOverview {
  people: number;
  storageBytes: number;
  notes: number;
  lastSignIns: { name?: string; email?: string; at: number }[] | number;
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

const q = makeFunctionReference;

export const serverRefs = {
  info: q<"query", Record<string, never>, ServerInfoCore>("server:info"),
  claimOwner: q<"mutation", { setupToken: string }, { ok: boolean }>("server:claimOwner"),
};

export const serverInviteRefs = {
  preview: q<"query", { token: string }, { serverName: string; invitedBy: string; email?: string | null; role: ServerRole; expired: boolean } | null>("serverInvites:preview"),
  accept: q<"mutation", { token: string }, { ok?: boolean } | null>("serverInvites:accept"),
};

export const serverAdminRefs = {
  getSettings: q<"query", Record<string, never>, ServerSettings>("serverAdmin:getSettings"),
  updateSettings: q<"mutation", ServerSettingsPatch, unknown>("serverAdmin:updateSettings"),
  listPeople: q<"query", Record<string, never>, ServerPerson[]>("serverAdmin:listPeople"),
  invite: q<"mutation", { email?: string; role: ServerRole }, { token: string; url: string; expiresAt: number }>("serverAdmin:invite"),
  listInvites: q<"query", Record<string, never>, ServerInvite[]>("serverAdmin:listInvites"),
  revokeInvite: q<"mutation", { token: string }, unknown>("serverAdmin:revokeInvite"),
  setRole: q<"mutation", { userId: string; role: ServerRole }, unknown>("serverAdmin:setRole"),
  transferOwnership: q<"mutation", { userId: string }, unknown>("serverAdmin:transferOwnership"),
  suspend: q<"mutation", { userId: string }, unknown>("serverAdmin:suspend"),
  unsuspend: q<"mutation", { userId: string }, unknown>("serverAdmin:unsuspend"),
  removePerson: q<"mutation", { userId: string }, unknown>("serverAdmin:removePerson"),
  endSessions: q<"mutation", { userId: string }, unknown>("serverAdmin:endSessions"),
  resetPassword: q<"mutation", { userId: string }, { url?: string; link?: string } | null>("serverAdmin:resetPassword"),
  setQuota: q<"mutation", { userId: string; quotaBytes: number | null }, unknown>("serverAdmin:setQuota"),
  testEmail: q<"action", { to: string }, { ok: boolean; error?: string }>("serverAdmin:testEmail"),
  overview: q<"query", Record<string, never>, ServerOverview>("serverAdmin:overview"),
};

/** Folevi Cloud only (CONTRACT §7, Connect). */
export const connectRefs = {
  myServers: q<"action", Record<string, never>, LinkedServer[]>("connect:myServers"),
  approveLink: q<"action", { code: string }, { ok?: boolean; name?: string } | null>("connect:approveLink"),
};
