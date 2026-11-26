# QNAP QTS 5 / QuTS hero (`.qpkg`)

**Unverified on real QTS.** The owner has no QNAP: see "Testing without a QNAP".

Build: `./build.sh --bundle <dir> --version 1.5.73 --arch x86_64|aarch64 --out out/`
(`--no-private-glibc` skips the glibc step, `--no-qdk` forces the scripted format). Needs `patchelf`.
Output: `folevi-server-<version>-qts5-<x86_64|arm_64>.qpkg`.

## Files

| File | What |
| --- | --- |
| `qpkg.cfg.in` | QDK package definition: name `folevi`, service `folevi.sh`, web UI `/` on 8460 (App Center Open button and main menu icon), QTS 5.0 minimum, volume selection, start/stop timeouts |
| `package_routines` | QDK hooks: requirement check (64-bit, memory), pre-install backup on upgrade, removal hooks that never touch data |
| `shared/folevi.sh` | Service script (start, stop, restart, status, backup, setup-url). Runs folevid as a `folevi` user it creates (BusyBox `adduser`, unverified) and refuses to start, with a line in the package log, when it cannot: Folevi Server never runs as root (admin). Links the private loader, picks the data folder |
| `populate-runtime-lib.sh` | Fills `bundle/runtime/lib` from Ubuntu 22.04 |
| `patch-private-glibc.sh` | Points `node` and `convex-backend` at it |
| `qinstall-minimal.sh` | Installer used only by the scripted format |
| Icons | `folevi.gif` 64, `folevi_80.gif`, `folevi_gray.gif` (placeholders) |

Data: the `Folevi` shared folder if the owner created one before installing (so HBS 3 and snapshots cover it),
else `<install folder>/data`. Override: `setcfg folevi Data_Path /share/<folder> -f /etc/config/qpkg.conf`.

## The private glibc

QTS 5 ships glibc 2.21; the Convex backend needs 2.35 (and GCC 12's libstdc++, `GLIBCXX_3.4.30`), Node.js 24
needs 2.28 (`docs/self-hosting/PHASE0.md` section 6). Nothing on the NAS is changed; the package brings its own:

1. **Populate** (`populate-runtime-lib.sh`): downloads `libc6`, `libstdc++6` and `libgcc-s1` for the target
   arch from Ubuntu's `jammy-updates` archive, checks `InRelease` with Ubuntu's archive key (when the keyring is
   present, as on CI) and every file by SHA256, and copies into `bundle/runtime/lib`: the loader
   (`ld-linux-x86-64.so.2` or `ld-linux-aarch64.so.1`), `libc.so.6`, `libm.so.6`, `libpthread.so.0`,
   `libdl.so.2`, `librt.so.1`, `libresolv.so.2`, `libutil.so.1`, `libstdc++.so.6`, `libgcc_s.so.1`. Licenses go to
   `bundle/LICENSES/runtime-lib/`. `--from-rootfs <dir>` takes them from an unpacked system instead.
2. **Patch** (`patch-private-glibc.sh`, at build time, QNAP copy only): sets the ELF interpreter of `node` and
   `convex-backend` to `/usr/local/lib/folevi-rt/ld.so` and their `DT_RPATH` to `$ORIGIN/../../lib` and
   `$ORIGIN/../runtime/lib`. The loader path must be absolute, and QTS install paths vary by volume, so:
3. **Link** (`folevi.sh start`, as root, every start because QTS rebuilds `/` at boot):
   `/usr/local/lib/folevi-rt/ld.so -> <install>/bundle/runtime/lib/ld-linux-*.so.*`.

Why patch rather than only run `ld.so --library-path runtime/lib node` (what folevid's `Bundle.Wrap` does): with
the explicit loader, Node's `process.execPath` is the loader, so Node cannot start itself again, and programs the
backend starts by name through `PATH` would use the NAS's old glibc. Patched binaries work in both cases, and
programs they start through `/bin/sh` keep using the NAS's own libraries (no `LD_LIBRARY_PATH` anywhere).
`$ORIGIN` is resolved through `/proc/self/exe`, which QTS has.

**Proof without a QNAP:** `../test/test-private-glibc.sh --bundle <dir> --arch <arch>` runs `node --version` and
`convex-backend --help` through the private glibc in `ubuntu:16.04` (glibc 2.23) and `centos:7` (2.17) with
Docker, both ways (loader and patched), and checks a Node child started through `process.execPath`. Without
Docker, as root, it uses Ubuntu's official 16.04 base filesystem in a chroot. Here it passed in the chroot with
the fake bundle (C and C++ programs linked against a newer glibc, which fail there without it). CI runs it on the
real bundle for both chips (`server-packages.yml`, step "Old-glibc test").

## Package format

- **Release path: QNAP's QDK** (`qbuild`, github.com/qnap-dev/QDK). `build.sh` uses it when `qbuild` is in
  `PATH` (or `QDK_QBUILD` is set). CI tries `InstallToUbuntu.sh install` (unverified on GitHub runners).
- **Scripted fallback** (no QDK): the same layout qbuild writes, read from qbuild's source: a `#!/bin/sh` header
  that knows its own length (`script_len=`) and extracts the next parts with `dd`; a plain tar holding
  `control.tar.gz` (`qinstall.sh`, `package_routines`, `qpkg.cfg`, `built_version`); `data.tar.gz` (the install
  folder: `bundle/`, `folevi.sh`, `.qpkg_icon*.gif`); and the 100-byte tail (model, padding, name in 20,
  version in 10, `QNAPQPKG  `). **Limits:** no QDK checksum (`qpkg_encrypt`) and no signature, so QTS may reject
  it as invalid; `qinstall-minimal.sh` is a small stand-in for QDK's installer (no in-place migration, no App
  Center notifications). Use it for structure tests only.

## Signing

QTS 5 blocks apps without a valid QNAP digital signature unless the owner turns on App Center > Settings >
"Allow installation of applications without a valid digital signature", and never installs packages it finds
invalid. Only QNAP can sign: apply to QNAP's partner program; QNAP signs with its code-signing service as part of
the QDK build. Until then: Qnapclub store, or the setting above with a clear guide.

## Testing without a QNAP

- **QuTScloud** (unverified): QNAP's QTS as a virtual appliance. It runs on KVM, VMware, Hyper-V and cloud
  hosts; Synology's Virtual Machine Manager is KVM-based, so it may run on a Synology that supports VMM (the DS223
  does not: VMM needs an x86 model). QuTScloud needs a license from QNAP's store (check the current terms and
  whether a trial exists before buying). Use it for the x86_64 package; it does not cover ARM QNAP models.
  Check `ldd --version` there: QuTScloud may not match QTS 5's 2.21.
- **Beta testers:** a short call for QNAP owners (one x86 and one ARM model, QTS 5.1 or 5.2, one QuTS hero) with
  this checklist: allow unsigned apps; Install Manually; open Folevi Server from the main menu; send
  `cat /share/CACHEDEV1_DATA/.qpkg/folevi/folevi-package.log`, `uname -m`, `ldd --version`, and
  `/sbin/getcfg folevi Install_Path -f /etc/config/qpkg.conf`; update to a newer build; uninstall and confirm the
  data folder remains.
- **CI** proves the glibc part on old glibc images on every run.

## Screenshots to take

App Center > Install Manually; the unsigned-app warning and setting; Folevi in App Center (running, Open); the
main menu icon; HBS 3 job including the `Folevi` folder.
