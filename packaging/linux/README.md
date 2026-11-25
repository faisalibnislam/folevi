# Linux servers (`.deb`, `.rpm`, repositories, installer, clouds)

## Packages

`build.sh --bundle <dir> --version 1.5.73 --arch x86_64|aarch64 --out out/` builds `folevi-server` with nfpm
(`go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.43.0`):

- `/opt/folevi`: the bundle. `/var/lib/folevi`: data (mode 750, owned by the `folevi` system user).
- `folevi-server.service`: systemd, runs as `folevi`, hardened (`ProtectSystem=strict`, `NoNewPrivileges`),
  `CAP_NET_BIND_SERVICE` so it can serve 80/443 on a public server, `FOLEVI_MANAGED_BY=apt`.
- `/etc/default/folevi-server`: created once from `folevi-server.default` (ports), never overwritten.
- Scripts: `preinstall` (user, pre-update backup), `postinstall` (enable, start, print the setup address),
  `preremove`/`postremove` (stop on removal; data is never deleted, even on purge).
- Optional rpm signing: `FOLEVI_RPM_SIGNING_KEY_FILE` (+ `NFPM_RPM_PASSPHRASE`).

## Repositories

- `repo/build-server-apt-repo.sh --debs <dir> --out <dir>`: `pool/`, `dists/stable/` with `Release`, `InRelease`,
  `Release.gpg`, and `folevi-archive-keyring.gpg`. Serve at `https://pkg.folevi.com/apt`.
- `repo/build-server-rpm-repo.sh --rpms <dir> --out <dir> [--channel stable]`: per-arch `repodata` with signed
  `repomd.xml.asc`, `RPM-GPG-KEY-folevi`, `folevi.repo`. Serve at `https://pkg.folevi.com/rpm/<channel>`.
- Signing key: `FOLEVI_REPO_GPG_PRIVATE_KEY` (ASCII-armored, from a CI secret), imported into a temporary
  GNUPGHOME that is deleted afterwards, never printed. Without it the repositories are unsigned (tests only).

## Installer

`install.sh`, served as `https://get.folevi.com/server`: `curl -fsSL https://get.folevi.com/server | sh`.
Checks Linux, x86_64/aarch64, systemd, memory; Debian 12+/Ubuntu 22.04+ get the apt repository with a
`signed-by` keyring, Fedora/RHEL 9+ get the dnf repository; installs, enables, prints the setup address.
Everything runs from `main` on the last line, so a cut-off download does nothing. `FOLEVI_CHANNEL=beta`,
`FOLEVI_DRY_RUN=1` print-only mode.

## Clouds

- `cloud/hetzner/cloud-init.yaml`: paste as "Cloud config" when creating a Hetzner server: ports 80/443, swap on
  small servers, firewall, installer; the setup address lands in `/root/folevi-setup.txt`.
- `cloud/digitalocean/`: Packer template for a Marketplace 1-Click image following
  `digitalocean/marketplace-partners`: per-instance first boot script (each Droplet makes its own secrets), MOTD
  with the setup address, `90-cleanup.sh`, and `99-img-check.sh` (fetches DigitalOcean's current checker).
  Building needs the owner's DigitalOcean token and OK; it creates a snapshot.
- App platforms: `../paas/`.

**Unverified:** none of this has been installed on a real server yet. Test on Debian 12, Ubuntu 24.04 and
Fedora/Rocky 9 before publishing `get.folevi.com`.
