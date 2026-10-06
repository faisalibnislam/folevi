import { ConvexError } from "convex/values";

export type ErrorCode =
  | "unauthenticated"
  | "email_unverified"
  | "mfa_required"
  | "suspended"
  | "account_deleted"
  | "profile_missing"
  | "forbidden"
  | "not_found"
  | "invalid_argument"
  | "invalid_block"
  | "conflict"
  | "rate_limited"
  | "quota_exceeded"
  | "maintenance"
  | "expired"
  | "password_required"
  | "unsupported_file"
  | "limit_exceeded"
  | "device_limit"
  | "out_of_credits";

export function fail(code: ErrorCode, message?: string, extra?: Record<string, string | number | boolean>): never {
  throw new ConvexError({ code, message: message ?? code, ...extra });
}
