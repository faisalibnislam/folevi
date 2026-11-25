# Folevi Server packaging

Every platform wraps the same bundle (`docs/self-hosting/CONTRACT.md` section 10), built by
`server/bundle/build-bundle.sh` once per chip. Each `packaging/<platform>/build.sh` takes the same inputs:

```
build.sh --bundle <bundle dir> --version 1.5.73 --arch x86_64|aarch64 --out <dir>
```

`build-all.sh` runs them all. `test/build-all-fake.sh` builds everything from a fake bundle and checks each
package's structure (about 200 checks, all passing). CI: `.github/workflows/server-packages.yml`, manual
(`workflow_dispatch`) only; it never publishes, pushes or uploads.

## Status

"Built and checked" means the fake-bundle test builds it and validates its structure here. Nothing has been
installed on real hardware yet: **everything is unverified until tested on the real system.**

| Platform | Folder | Output | Status |
| --- | --- | --- | --- |
| Synology DSM 7.2+ | `synology/` | `.spk` (x86_64, armv8 incl. rtd1619b) + package source index | Built and checked. Format from Synology's DSM 7 developer guide. Webservice/portal resource is opt-in (`--with-webservice`), unverified |
| QNAP QTS 5 / QuTS hero | `qnap/` | `.qpkg` with private glibc | Built and checked; private glibc proven in a glibc 2.23 chroot. Release builds need QNAP's QDK (CI tries to install it) and QNAP's signature |
| ASUSTOR ADM 4/5 | `asustor/` | `.apk` (apkg) | Built and checked (structure). Unverified |
| TerraMaster TOS 6 | `terramaster/` | `.tpk` | **Placeholder layout, unverified**: TerraMaster's schema was not available |
| UGREEN UGOS Pro | `ugreen/` | `.upk` + container guide | **Placeholder, unverified, pending UGREEN developer authorization**. Container route ready to test |
| Unraid 6.12+ | `unraid/` | `.plg` + plugin `.txz` + bundle tarball; CA container template | Built and checked. Unverified |
| Container | `docker/` | image (OCI archive in CI), `compose.yaml` | Context checked here; image builds in CI only (no Docker daemon here) |
| TrueNAS CE, ZimaOS/CasaOS, Umbrel, Runtipi | `catalogs/` | catalog entries | YAML/JSON checked. Unverified with each catalog's own tooling |
| Debian/Ubuntu, Fedora/RHEL | `linux/` | `.deb`, `.rpm`, apt + rpm repos, `install.sh` | Built and checked (`dpkg-deb -I`, signed `InRelease` verified with a throwaway key). rpm repo needs `createrepo_c` (CI) |
| Hetzner, DigitalOcean | `linux/cloud/` | cloud-init, Packer template | Unverified |
| Coolify, Dokploy, Railway, Fly, Render | `paas/` | templates | Unverified |

## Things every package does

- Runs `folevid run --data <dir> --bundle <dir>` as an unprivileged user (Synology: the package user; QNAP and
  ASUSTOR: a `folevi` user created with BusyBox tools, unverified; Linux: `folevi` system user; Unraid: `nobody`;
  container: uid 10001).
- Keeps data in a shared folder the NAS's backup tools see, and never deletes it on uninstall.
- Sets `FOLEVI_MANAGED_BY` (`store`, or `apt` for Linux packages) so the admin panel's Updates page is right.
- Takes a pre-update backup with the old version (`lib/pre-update-backup.sh`). `folevid backup` needs a running
  folevid, so when the store has already stopped the package the helper starts the old version briefly, waits
  for `folevid healthcheck`, backs up and stops it. Failure is logged, not fatal.

## Download manifest

`manifest/make-latest.sh --version V --out latest.json <package files or folders>` writes the manifest the
download page reads (`{version, releasedAt, channel, notesUrl, baseUrl, files:[{platform, arch, name, url, sha256,
sizeBytes}], unraidPluginUrl, installScript, dockerImage}`; channel `beta` by default). The Server packages
workflow builds it as the `latest-json` artifact. The owner uploads the package files to R2 (`folevi-updates`,
`server/<version>/<name>`) and the manifest to `server/latest.json`; nothing here uploads.

## What the owner must provide

- **Accounts:** Synology third-party developer program; QNAP partner program (code signing); ASUSTOR Developer
  Corner; TerraMaster TOS Developer Platform; UGREEN developer authorization; DigitalOcean Marketplace vendor;
  a container registry namespace (templates assume `ghcr.io/folevi/folevi-server`).
- **Hosting:** `get.folevi.com/server` (serves `linux/install.sh`), `pkg.folevi.com` (apt, rpm, Synology
  source, Unraid files, icons). Names are placeholders until the owner decides.
- **Signing key:** a GPG key for the apt/rpm repositories and rpm packages, stored as the
  `FOLEVI_PACKAGE_SIGNING_KEY` Actions secret (ASCII-armored, no passphrase, or extend the workflow with
  `NFPM_RPM_PASSPHRASE`/`FOLEVI_REPO_GPG_PASSPHRASE`). Never generated or committed here.
- **Artwork:** `icons/` holds placeholders made by `icons/make-icons.py`; real icons and store screenshots are needed.
- **Hardware:** a Synology DS223 (owned, ARM64, see `synology/README.md`); QNAP via QuTScloud or beta testers
  (`qnap/README.md`); the rest via beta testers.

## Notes for the other workstreams

- QNAP: folevid's `Bundle.Wrap` runs programs as `ld-linux --library-path runtime/lib <program>`. For Node that
  makes `process.execPath` the loader, so anything that starts `process.execPath` again breaks, and programs the
  backend starts through `PATH` are not wrapped. The QNAP package therefore also patches `node` and
  `convex-backend` (interpreter `/usr/local/lib/folevi-rt/ld.so`, RPATH into `runtime/lib`), which works both
  directly and through Wrap. Suggest folevid run binaries directly when their interpreter already exists, and
  that the bundle leaves `runtime/lib` empty (packages that need it fill it).
- The bundle interface CI assumes: `server/bundle/build-bundle.sh --version <v> --arch <x86_64|aarch64> --out <dir>`
  producing `<dir>/folevi-server-<v>-linux-<arch>/`.
