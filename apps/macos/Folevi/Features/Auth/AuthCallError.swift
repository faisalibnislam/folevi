import Foundation

/// A refused Better Auth call: its status and code (INVALID_PASSWORD, INVALID_CODE…).
struct AuthCallError: Error, Sendable {
    var status: Int
    var code: String
    var message: String?

    /// The web's `authErrorMessage`: plain language, generic for credentials, honest about rate limits.
    func userMessage(fallback: String = String(localized: "Something went wrong. Please try again."), wait: String = String(localized: "a minute")) -> String {
        if status == 429 || code == "TOO_MANY_REQUESTS" { return String(localized: "Too many attempts. Wait \(wait), then try again.") }
        switch code {
        case "INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD", "USER_NOT_FOUND", "INVALID_EMAIL", "CREDENTIAL_ACCOUNT_NOT_FOUND":
            return String(localized: "The email or password is incorrect.")
        case "EMAIL_NOT_VERIFIED": return String(localized: "Verify your email address first. We've sent you a new link.")
        case "PASSWORD_TOO_SHORT": return String(localized: "Use at least 10 characters for your password.")
        case "PASSWORD_TOO_LONG": return String(localized: "Use at most 128 characters for your password.")
        case "INVALID_CODE": return String(localized: "That code didn't work. Check your authenticator app and try again.")
        case "INVALID_BACKUP_CODE": return String(localized: "That backup code didn't work. Each code works only once.")
        case "OTP_HAS_EXPIRED", "TWO_FACTOR_NOT_ENABLED", "INVALID_TWO_FACTOR_COOKIE", "SESSION_EXPIRED":
            return String(localized: "This sign-in attempt expired. Start again from the sign-in page.")
        case "INVALID_TOKEN", "TOKEN_EXPIRED": return String(localized: "This link is invalid or has expired. Request a new one.")
        case "ACCOUNT_TEMPORARILY_LOCKED", "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
            return String(localized: "Too many incorrect codes. For your security this account is locked for a while. Try again later or reset your password.")
        default:
            if let message, !message.isEmpty, message.range(of: "internal", options: .caseInsensitive) == nil { return message }
            return fallback
        }
    }
}
