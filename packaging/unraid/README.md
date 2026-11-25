# Unraid 6.12+ (native plugin and Community Apps template)

**Unverified: test on a real Unraid server.** Unraid is x86_64 only.

Build: `./build.sh --bundle <dir> --version 1.5.73 --arch x86_64 --out out/ [--base-url https://pkg.folevi.com/unraid]`
Upload the three outputs to the base URL: `folevi.plg`, `folevi-plugin-<v>-x86_64-1.txz`,
`folevi-server-<v>-x86_64.tar.xz`.

How it works:

- Unraid's root filesystem is in RAM, so the plugin keeps the bundle tarball in its flash folder
  (`/boot/config/plugins/folevi/`, about the size of the bundle; only the current version is kept) and reinstalls
  its small `.txz` (settings page, `rc.folevi`, event hooks) at every boot.
- At array start (`event/started`) `rc.folevi` unpacks the bundle to `INSTALL_DIR/<version>` on the array
  (default `/mnt/user/appdata/folevi/server`), keeps the previous version, takes a pre-update backup with it, and
  starts `folevid` as `nobody`. `event/stopping_svcs` stops it before the array goes down.
- Settings > Folevi Server (`Folevi.page`): start with the array, data folder (default
  `/mnt/user/appdata/folevi/data`; a pool path such as `/mnt/cache/appdata/folevi/data` is better for SQLite),
  program folder, ports, run-as user. Apply restarts the server.
- Removing the plugin keeps data and settings.

Container alternative: `ca/folevi.xml` (Community Apps template; the image starts as root only to set the data
folder owner to 99:100, then drops privileges).

Submitting: Community Applications needs the plugin and template in a public repository and a support thread on
the Unraid forum. Screenshots to take: Apps tab search result; plugin install log; Settings > Folevi Server; the
setup page.
