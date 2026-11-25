//! Windows Hello: whether this PC can ask (a face, a fingerprint or the PIN), and asking, in front of the window
//! that wants it (UserConsentVerifier through IUserConsentVerifierInterop, so the prompt belongs to Folevi's window).
//! The app lock (applock.rs) and "Ask before unlocking encrypted notes" (e2ee.rs) use it.

#[cfg(windows)]
mod imp {
    use windows::core::{factory, HSTRING};
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
    use windows_future::IAsyncOperation;

    pub fn available() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.join())
            .is_ok_and(|a| a == UserConsentVerifierAvailability::Available)
    }

    /// Blocks until the person answers: true only when Windows Hello said it's them.
    pub fn verify(hwnd: isize, message: &str) -> bool {
        let message = HSTRING::from(message);
        let asked: windows::core::Result<IAsyncOperation<UserConsentVerificationResult>> = (|| {
            let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
            unsafe { interop.RequestVerificationForWindowAsync(HWND(hwnd as *mut _), &message) }
        })();
        let asked = match asked {
            Ok(op) => Ok(op),
            // No window to attach to (hidden, or none yet): the plain prompt.
            Err(_) => UserConsentVerifier::RequestVerificationAsync(&message),
        };
        asked.and_then(|op| op.join()).is_ok_and(|r| r == UserConsentVerificationResult::Verified)
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn available() -> bool {
        false
    }

    pub fn verify(_hwnd: isize, _message: &str) -> bool {
        false
    }
}

pub use imp::{available, verify};
