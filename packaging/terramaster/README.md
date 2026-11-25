# TerraMaster TOS 6 (`.tpk`)

**Unverified, best effort.** TOS 6 is systemd-based, and TerraMaster opened its TOS Developer Platform on
2026-10-30, but its package schema was not available to us. `build.sh` makes a placeholder `.tpk` (gzip tar):

```
manifest.json   icon.png   scripts/{preinst,postinst,prerm,postrm}
app/            -> /usr/local/folevi: bundle/, folevi.service, systemd-nas-scripts.sh, pre-update-backup.sh
```

The hooks (`../lib/systemd-nas-scripts.sh`) create a `folevi` system user, write `folevi.env`
(`FOLEVI_DATA=/Volume1/folevi` by default), install and enable `folevi.service`, take a pre-update backup, and
never delete data. Shared with the UGREEN placeholder (`../lib/build-systemd-nas.sh`).

To finish: get TerraMaster's package spec and rename or restructure the manifest and hooks to match; check
`ldd --version` on TOS 6 (2.35 or newer needs no private glibc); test on a TOS 6 NAS. The owner needs a TOS
Developer Platform account and real artwork.

Build: `./build.sh --bundle <dir> --version 1.5.73 --arch x86_64|aarch64 --out out/`
