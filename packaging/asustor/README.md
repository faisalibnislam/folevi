# ASUSTOR ADM 4.x/5.x (`.apk`, ASUSTOR's "apkg" format)

**Unverified: test on a real ASUSTOR NAS.**

Build: `./build.sh --bundle <dir> --version 1.5.73 --arch x86_64|aarch64 --out out/`
Output: `folevi_<version>_<x86-64|arm64>.apk`. With ASUSTOR's `apkg-tools.py` available, set
`APKG_TOOLS=<path>` and it is used instead (the reference implementation).

Format (from ASUSTOR's developer guide): a zip with `apkg-version` ("2.0"), `control.tar.gz` (the `CONTROL/`
files) and `data.tar.gz` (installed to `/usr/local/AppCentral/folevi`).

| File | What |
| --- | --- |
| `CONTROL/config.json.in` | `general` (package, version, architecture `x86-64` or `arm64`, firmware 4.2.0), `adm-desktop.app` (desktop icon opening port 8460), `register.share-folder` (creates the `Folevi` share for Backup Plan), ports 8460/8443, boot order |
| `CONTROL/start-stop.sh` | start/stop; runs folevid as a `folevi` user (BusyBox `adduser`, unverified) |
| `CONTROL/pre-install.sh` | pre-update backup on upgrade |
| `CONTROL/post-install.sh`, `pre-uninstall.sh`, `post-uninstall.sh` | user setup, stop; data is never removed |
| `CONTROL/icon.png` | 90x90 placeholder |

Unverified details to check on hardware: the architecture strings, whether `/share/Folevi` is the path of the
registered share, and ADM's glibc (`ldd --version`; if older than 2.35, reuse the QNAP private glibc steps).
The owner needs an ASUSTOR Developer Corner account; App Central lists apps after ASUSTOR's review.

Screenshots to take: App Central > Manual Install; the Folevi icon on the ADM desktop; the setup page; Backup
Plan including the Folevi share.
