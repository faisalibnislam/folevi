# Container image

`Dockerfile` (Debian 12 slim: glibc 2.36 and GCC 12 libstdc++, enough for Convex and Node without `runtime/lib`).
The image holds the same bundle at `/opt/folevi`, runs `folevid run --data /data --bundle /opt/folevi` as uid
10001 under `tini`, declares the `/data` volume, exposes 8460 and 8443, and checks health with
`folevid healthcheck`.

Started as root (`user: "0:0"`), `docker-entrypoint.sh` makes `/data` owned by `FOLEVI_UID:FOLEVI_GID` (default
10001) and drops to that user first. Templates use this where the host creates the data folder as root.

`build.sh --bundle <x86_64 bundle> --bundle-arm64 <aarch64 bundle> --version <v> --arch x86_64 --out <dir> --build`
prepares the context (`bundles/amd64`, `bundles/arm64`) and runs `docker buildx` to an OCI archive. It never
pushes. Without `--build` it only writes the context (what the fake test checks; there is no Docker daemon here).

`compose.yaml`: the minimal Compose file for any Docker host.

Unverified: the image has not been built yet (CI builds it). The owner must pick the registry
(`ghcr.io/folevi/folevi-server` is assumed in every template) and decide when to push.
