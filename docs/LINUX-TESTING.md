# Testing Folevi for Linux

A checklist for trying the test builds on real Linux computers. It takes about 20 minutes per computer. Use a
test account or "On this computer" with a few throwaway notes, never your real library.

The builds are on folevi.com (1.5.75, published 2026-11-24) and in `~/Downloads/Folevi for Linux 1.5.75 test/`
on the Mac:

| File | Use it on | Latest link |
| --- | --- | --- |
| `Folevi_<version>_amd64.AppImage` | Any Intel or AMD PC | https://folevi.com/download/linux/Folevi-x86_64.AppImage |
| `Folevi_<version>_aarch64.AppImage` | Any ARM computer (Snapdragon laptop, Raspberry Pi 5) | https://folevi.com/download/linux/Folevi-aarch64.AppImage |
| `Folevi_<version>_amd64.deb` | Ubuntu, Debian, Mint, Pop!_OS (Intel/AMD) | https://folevi.com/download/linux/Folevi-amd64.deb |
| `Folevi_<version>_arm64.deb` | The same, on ARM | https://folevi.com/download/linux/Folevi-arm64.deb |
| `Folevi-<version>-1.x86_64.rpm` | Fedora, openSUSE (Intel/AMD) | https://folevi.com/download/linux/Folevi-x86_64.rpm |
| `Folevi-<version>-1.aarch64.rpm` | The same, on ARM | https://folevi.com/download/linux/Folevi-aarch64.rpm |
| `SHA256SUMS.txt` | To check a download: `sha256sum -c SHA256SUMS.txt --ignore-missing` | https://folevi.com/download/linux/SHA256SUMS.txt |

Flatpak (test only, not on Flathub or folevi.com): `Folevi-1.5.75-aarch64.flatpak` for ARM is in the Downloads
folder (built in the VM, opens there); the Intel/AMD one comes from CI (`.github/workflows/desktop.yml`, artifact
"Folevi Linux Flatpak x86_64") or `packaging/linux/scripts/flatpak-bundle.sh`. Section 3.

Write down anything that looks wrong with the distribution, desktop (GNOME, KDE...) and whether it's Wayland or
X11 (Settings > About, or run `echo $XDG_SESSION_TYPE` in a terminal).

## 1. Ubuntu 24.04 (or 22.04), the .deb

- [ ] Double-click the .deb. App Center (or Software Install) opens it; click Install. It asks for your password.
- [ ] Folevi is in the app grid with its icon. Open it.
- [ ] The window looks like the web app, sharp text, no blank or white window.
- [ ] Sign in (Google, Apple or email). The browser opens for Google and Apple and comes back to Folevi.
- [ ] Quit Folevi (tray menu > Quit) and open it again: still signed in.
- [ ] Settings > Appearance > System. Switch Ubuntu between light and dark (Settings > Appearance): Folevi follows
      within a second.
- [ ] Tray icon in the top bar: its menu opens Folevi, New Note and Quit.
- [ ] Right-click Folevi in the dock: New Note, Quick Add, Today's Tasks work.
- [ ] Open a `folevi://` link: in a terminal, `xdg-open folevi://new`. Folevi comes to the front with a new note
      (and no second window).
- [ ] A reminder or a comment shows a desktop notification; clicking it opens the note.
- [ ] Quick Add (Ctrl+Alt+Space):
  - On Ubuntu 24.04 or 22.04 with Wayland (the default) it can't work by itself: Settings > Desktop app explains how
    to add the shortcut in Ubuntu's Settings > Keyboard. Do that, then press it from another app.
  - Log out, pick "Ubuntu on Xorg" on the login screen's gear: Ctrl+Alt+Space works directly.
- [ ] Export a note (or import a file): the file dialog is the normal Ubuntu one.
- [ ] "On this computer" library: pick a folder, add a note, check the file appears in that folder.
- [ ] Uninstall: App Center > Installed > Folevi > Uninstall.

## 2. Fedora 42 or newer (Workstation or KDE), the .rpm

- [ ] Double-click the .rpm. GNOME Software (or Discover) opens it; Install.
  - If it refuses an unsigned package: in a terminal, `sudo dnf install ./Folevi-*.rpm`.
- [ ] Same checks as Ubuntu: opens, sign in, stays signed in, light/dark, `xdg-open folevi://new`, notifications,
      file dialog.
- [ ] Quick Add on Fedora 42+ (GNOME 48+) or KDE: the first press of Ctrl+Alt+Space (or opening Folevi) shows the
      desktop's own "allow shortcut" dialog. Allow it; then Ctrl+Alt+Space from another app opens Quick Add.
- [ ] Tray: KDE shows it. Fedora's GNOME shows it only with the "AppIndicator and KStatusNotifierItem Support"
      extension; without it there's no tray icon (expected).
- [ ] Uninstall: `sudo dnf remove folevi`.
- [ ] openSUSE: `sudo zypper install --allow-unsigned-rpm ./Folevi-*.rpm`, then the same checks.

## 3. Any distribution, the Flatpak

- [ ] `flatpak install --user Folevi-1.5.75-<arch>.flatpak` (it may first ask to install the GNOME 51 runtime
      from Flathub: say yes).
- [ ] `flatpak run com.folevi.Folevi`, or open it from the app grid.
- [ ] Sign in; quit and reopen: still signed in.
- [ ] Light/dark follows the desktop.
- [ ] Export and import: the file dialog shows your real home folder, and only the file you pick is shared.
- [ ] "On this computer" library in a folder you pick: survives a restart of Folevi.
- [ ] Notifications show.
- [ ] Uninstall: `flatpak uninstall com.folevi.Folevi`.

## 4. The AppImage (any distribution)

- [ ] Right-click the AppImage > Properties > allow running as a program (or `chmod +x`), then double-click.
  - Ubuntu 24.04 says "AppImages require FUSE": `sudo apt install libfuse2t64` (22.04: `libfuse2`).
- [ ] It opens, signs in, remembers the sign-in.
- [ ] After the first run, `xdg-open folevi://new` reaches it.
- [ ] Updates: not testable until there's a newer version on folevi.com (we check this before the first release).

## Also worth a look

- [ ] An ARM computer with the aarch64 build.
- [ ] A computer with an NVIDIA graphics card: the window isn't blank.
- [ ] A 4K or HiDPI screen with scaling: text and icons sharp.
