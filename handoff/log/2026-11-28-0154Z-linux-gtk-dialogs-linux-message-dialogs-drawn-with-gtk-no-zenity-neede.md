# Linux: message dialogs drawn with GTK, no zenity needed

- Date: 2026-11-28 01:54 UTC
- Area: linux
- Branch: claude/linux-gtk-dialogs

What changed: on Linux, Folevi's message dialogs (the update offer, "Folevi is up to date", the download and
install errors) are drawn with GTK (`linux::message_dialog`, `gtk` 0.18, the bindings Tauri already uses) over the
main window when it's showing. `updates.rs` goes through one `show()` helper: GTK on Linux, the dialog plugin on
Windows (unchanged). The install-failure message no longer blocks a thread; Folevi restarts when it's dismissed.

Why: the Linux build uses the dialog plugin's portal backend for the file chooser, and that backend shows message
dialogs by running `zenity`. Without zenity (KDE, minimal installs) the update offer never appeared and nothing was
logged (found while testing the AppImage update on 2026-11-28). The owner chose "ship first, fix after", so 1.9.80
went out without this.

Checked (Lima VM, aarch64 AppImage, own Xvfb display, zenity uninstalled):
- Check for Updates in the tray: "Folevi is up to date / Folevi 1.9.80 is the newest version." in a GTK dialog; OK
  closes it.
- A test build stamped 1.9.79 (version.json changed locally, not committed) offered 1.9.80 after the first check,
  with Later and Install and Restart; Return chose Install and Restart; the AppImage became the 1.9.80 release file
  (SHA-256 `2f2d721b...`) and Folevi restarted as 1.9.80.
- `cargo check` on the Mac (the non-Linux path) passes with no new warnings.

Not checked: a real KDE or GNOME desktop, Wayland, dark mode on the dialog, and the Windows build (CI builds it).
Also: the VM's disk was full (old snapcraft LXD containers); deleting them fixed "failed to run linuxdeploy".
