# Synology DSM 7.2+ (`.spk`)

**Unverified on real DSM until the DS223 test below passes.**

Build: `./build.sh --bundle <dir> --version 1.5.73 --arch aarch64 --out out/` (add `--beta`, `--revision N`,
`--with-webservice`). Output: `folevi-server-<version>-dsm7-<x86_64|armv8>.spk`.

## What is in it

| Part | What it does |
| --- | --- |
| `INFO.in` | `os_min_ver="7.2-64570"`; `arch` lists the family and platform names (`armv8 rtd1619b rtd1296 armada37xx`, and `x86_64` plus the x86 platforms); `adminport` 8460 for the Open button; `dsmuidir`/`dsmappname` for the main menu |
| `conf/privilege` | `run-as: package` (DSM 7 rule: never root) |
| `conf/resource.json` | `port-config` (`app/folevi.sc`: 8460 and 8443 for the firewall and router port forwarding), `data-share` (the shared folder from the wizard, read-write for the package user, created if missing), `usr-local-linker` (`folevid` in `/usr/local/bin`) |
| `conf/resource.webservice.json` | Optional (`--with-webservice`): a DSM web portal at `/folevi` reverse-proxying to 8460 with the WebSocket headers. **Unverified**: DSM may not accept this service type from a third-party package; without it, owners use Control Panel > Login Portal > Advanced > Reverse Proxy (add the WebSocket custom header) |
| `WIZARD_UIFILES/` | Install wizard: pick the shared folder (default `folevi`). Uninstall wizard: says the data stays |
| `scripts/` | `start-stop-status` (start/stop/status/log), `postinst` (remembers the folder), `preupgrade` (pre-update backup) and the other hooks |
| `ui/config` | Main-menu entry "Folevi Server" opening `http://<nas>:8460/` |
| Icons | `PACKAGE_ICON.PNG` 64, `PACKAGE_ICON_256.PNG` 256, `ui/images/icon_{16..256}.png`: placeholders |

Data folder: `/var/packages/folevi/shares/<folder>` resolved to its real path (for example `/volume1/folevi`).
Package files: `/var/packages/folevi/target/bundle`. Package log (with the setup address after start):
`/var/packages/folevi/var/folevi-package.log`, shown by Package Center > Folevi Server > View log. folevid's own
logs: `<data folder>/logs/`.

## Package source

`package-source/generate-index.py --spks <dir> --base-url https://pkg.folevi.com/synology --out <dir>` writes
`index.json`, one index per family and an nginx `map` that answers Package Center's `?arch=` query with the right
file. Owners add `https://pkg.folevi.com/synology/` in Package Center > Settings > Package Sources. Unverified
against current DSM 7.2.

## Testing on the DS223

The owner's test NAS: DS223, Realtek RTD1619B (ARM64, platform `rtd1619b`), 2 GB RAM (cannot be expanded), DSM 7.2.
Use the `armv8` package.

1. **Before installing, over SSH** (Control Panel > Terminal & SNMP > Enable SSH; `ssh <admin>@<nas>`):
   - `uname -m` should print `aarch64`; `cat /proc/sys/kernel/syno_hw_version` shows the model.
   - `ldd --version | head -n 1`: must be **2.35 or newer** for the Convex backend (PHASE0.md section 6). If older,
     build with the QNAP private glibc approach (tell the packaging workstream).
   - `strings /usr/lib/libstdc++.so.6 | grep GLIBCXX_3.4.30` (no output means the system libstdc++ is too old:
     same fix).
   - `grep -E 'MemTotal|MemAvailable|SwapTotal' /proc/meminfo`: Folevi Server needs about 1 GB available; with
     2 GB total, stop other heavy packages during the test.
2. **Install:** Package Center > Manual Install > choose `folevi-server-<version>-dsm7-armv8.spk` > accept the
   third-party warning > wizard: keep `folevi` > Done.
3. **Check:** Package Center shows Running. Open Folevi Server from the main menu. Package Center > Folevi Server >
   View log shows the setup address. Over SSH: `cat /var/packages/folevi/var/folevi-package.log`,
   `ls /volume1/folevi/logs/` (folevid.log, backend.log, web.log), `ps -o user,rss,args -u folevi`.
4. **Upgrade test:** build the same version with `--revision 2`, Manual Install it over the first; a
   `pre-update` backup appears in `/volume1/folevi/backups/`.
5. **Uninstall test:** uninstall; `/volume1/folevi` must still be there.
6. Note memory at idle and during first sync (`top`, or Resource Monitor) for the 2 GB guidance.

## Screenshots to take

Package Center Manual Install; the install wizard folder step; the main menu with the Folevi icon; the package
running with View log; the setup page opened from the menu; Package Sources settings with Folevi's source; the
reverse proxy rule (if the webservice resource is not accepted).
