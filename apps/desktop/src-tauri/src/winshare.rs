//! Windows' Share sheet and text recognition (the Mac's Sharing.swift and TextRecognition.swift; docs/DESKTOP_PARITY.md
//! item 9). Linux has neither (no standard share sheet, no text recognition built in), so the page doesn't offer them
//! there.

/// The most text kept from one image (the Mac's limit).
#[allow(dead_code)]
pub const MAX_TEXT: usize = 100_000;
/// The largest image read (the Mac's limit).
pub const MAX_IMAGE: usize = 25 * 1024 * 1024;

#[cfg(windows)]
mod imp {
    use super::MAX_TEXT;
    use windows::core::{factory, HSTRING};
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager, TargetApplicationChosenEventArgs};
    use windows::Foundation::{TypedEventHandler, Uri};
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, BitmapTransform, ColorManagementMode, ExifOrientationMode};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::IDataTransferManagerInterop;

    /// Whether this PC can read text: a recognition language the person's languages have.
    pub fn ocr_available() -> bool {
        OcrEngine::TryCreateFromUserProfileLanguages().is_ok()
    }

    /// The text in an image (PNG, JPEG, GIF, BMP, TIFF, HEIC with its extension), lines joined with new lines.
    pub fn recognize(bytes: &[u8]) -> windows::core::Result<String> {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(bytes)?;
        writer.StoreAsync()?.join()?;
        writer.FlushAsync()?.join()?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
        let (w, h) = (decoder.OrientedPixelWidth()?, decoder.OrientedPixelHeight()?);
        let max = OcrEngine::MaxImageDimension()?.max(1);
        let transform = BitmapTransform::new()?;
        if w.max(h) > max {
            let scale = max as f64 / w.max(h) as f64;
            transform.SetScaledWidth(((w as f64 * scale) as u32).max(1))?;
            transform.SetScaledHeight(((h as f64 * scale) as u32).max(1))?;
        }
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied, &transform, ExifOrientationMode::RespectExifOrientation, ColorManagementMode::DoNotColorManage)?
            .join()?;
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let result = engine.RecognizeAsync(&bitmap)?.join()?;
        let mut text = String::new();
        for line in result.Lines()? {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&line.Text()?.to_string());
            if text.len() > MAX_TEXT {
                break;
            }
        }
        Ok(text.chars().take(MAX_TEXT).collect())
    }

    /// Opens the Share sheet in front of `hwnd` with a link (and its title), or text. Runs on the window's thread.
    /// `chosen` hears when the person picks where to share (Windows says nothing on cancel). Returns the handler
    /// tokens to remove before the next share.
    pub fn share(hwnd: isize, title: &str, text: &str, url: &str, chosen: Box<dyn Fn() + Send + Sync>) -> windows::core::Result<(DataTransferManager, i64, i64)> {
        let interop = factory::<DataTransferManager, IDataTransferManagerInterop>()?;
        let manager: DataTransferManager = unsafe { interop.GetForWindow(HWND(hwnd as *mut _))? };
        let (title, text, url) = (HSTRING::from(if title.is_empty() { "Folevi" } else { title }), HSTRING::from(text), url.to_string());
        let requested = manager.DataRequested(&TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(move |_, args| {
            let Some(args) = args.as_ref() else { return Ok(()) };
            let data = args.Request()?.Data()?;
            data.Properties()?.SetTitle(&title)?;
            if !url.is_empty() {
                data.SetWebLink(&Uri::CreateUri(&HSTRING::from(url.as_str()))?)?;
            }
            if !text.is_empty() {
                data.SetText(&text)?;
            } else if !url.is_empty() {
                data.SetText(&HSTRING::from(url.as_str()))?;
            }
            Ok(())
        }))?;
        let picked = manager.TargetApplicationChosen(&TypedEventHandler::<DataTransferManager, TargetApplicationChosenEventArgs>::new(move |_, _| {
            chosen();
            Ok(())
        }))?;
        unsafe { interop.ShowShareUIForWindow(HWND(hwnd as *mut _))? };
        Ok((manager, requested, picked))
    }

    thread_local! {
        /// The last share's handlers, on the window's thread (a window's manager is the same for good).
        static LAST: std::cell::RefCell<Option<(DataTransferManager, i64, i64)>> = const { std::cell::RefCell::new(None) };
    }

    /// share() on the window's thread, after taking the last share's handlers off. True when the sheet opened.
    pub fn share_now(hwnd: isize, title: &str, text: &str, url: &str, chosen: Box<dyn Fn() + Send + Sync>) -> bool {
        LAST.with(|last| {
            if let Some((m, a, b)) = last.borrow_mut().take() {
                let _ = m.RemoveDataRequested(a);
                let _ = m.RemoveTargetApplicationChosen(b);
            }
            match share(hwnd, title, text, url, chosen) {
                Ok(kept) => {
                    *last.borrow_mut() = Some(kept);
                    true
                }
                Err(e) => {
                    log::warn!("Folevi: the Share sheet didn't open: {e}");
                    false
                }
            }
        })
    }
}

#[cfg(windows)]
pub use imp::{ocr_available, recognize, share_now};

#[cfg(not(windows))]
pub fn ocr_available() -> bool {
    false
}
