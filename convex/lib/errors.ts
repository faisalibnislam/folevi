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
  | "limit_exceeded";

export function fail(code: ErrorCode, message?: string, extra?: Record<string, string | number | boolean>): never {
  throw new ConvexError({ code, message: message ?? code, ...extra });
}

export function assertArg(condition: unknown, message: string): asserts condition {
  if (!condition) fail("invalid_argument", message);
}
