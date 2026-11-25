# Catalog apps (container under the hood)

All use the Folevi Server image with one `/data` volume and port 8460. **Unverified with each catalog's own
tooling: run it before submitting.**

| Catalog | Folder | Submit to |
| --- | --- | --- |
| TrueNAS Community Edition 25.04+ | `truenas/folevi/` (`app.yaml`, `ix_values.yaml`, `questions.yaml`, `templates/docker-compose.yaml`, `templates/test_values/`) | `truenas/apps` under `ix-dev/community/folevi`. Copy the current `lib_version` and hash from a recent community app and run the repo's CI script. Runs as 568:568 (`apps`) |
| ZimaOS / CasaOS | `casaos/Folevi/docker-compose.yml` (`x-casaos` metadata) | `IceWhaleTech/CasaOS-AppStore` (and the ZimaOS store) |
| Umbrel | `umbrel/folevi/` (`umbrel-app.yml`, `docker-compose.yml`, `data/`) | `getumbrel/umbrel-apps`. The `app_proxy` login is turned off: Folevi has its own sign-in and the apps must reach the server directly |
| Runtipi | `runtipi/folevi/` (`config.json`, `docker-compose.yml`, `metadata/`) | `runtipi/runtipi-appstore` |

Each needs real artwork and screenshots (gallery images for Umbrel, screenshot links for CasaOS). The TrueNAS
healthcheck helper name (`set_custom_test`) and Umbrel's `PROXY_AUTH_ADD` behavior must be checked against the
current library and docs.
