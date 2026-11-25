# UGREEN UGOS Pro

Two routes. **Unverified: test on real hardware.**

| Route | Status | What |
| --- | --- | --- |
| Container (now) | Ready to test | [`CONTAINER_GUIDE.md`](CONTAINER_GUIDE.md) + [`compose.yaml`](compose.yaml), using the Folevi Server image |
| Native `.upk` | **Unverified, pending UGREEN developer authorization** | `build.sh` makes a placeholder `.upk` |

## Native `.upk` (best effort)

UGREEN's developer docs say a NAS needs developer authorization from UGREEN to install a `.upk`, and the
package schema was not public when this was written. `build.sh` therefore produces a **placeholder** with our
best guess of the layout (shared with TerraMaster in `../lib/build-systemd-nas.sh`):

```
manifest.json   icon.png   scripts/{preinst,postinst,prerm,postrm}
app/            -> /opt/folevi: bundle/, folevi.service (systemd), systemd-nas-scripts.sh
```

UGOS Pro is Debian-based with systemd and a recent glibc (check with `ldd --version` over SSH; 2.35 or newer means
no private glibc is needed). The service runs as the `folevi` system user; data defaults to `/volume1/folevi`
(settable in `/opt/folevi/folevi.env`).

Build: `./build.sh --bundle <dir> --version 1.5.73 --arch x86_64 --out out/`

What the owner must provide: a UGREEN developer account and authorization, UGREEN's package spec, a DXP NAS for
testing, real artwork (the icon is a placeholder from `../icons/`).
