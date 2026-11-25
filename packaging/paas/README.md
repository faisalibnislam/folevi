# Folevi Server on app platforms

All of these run the Folevi Server container image (`ghcr.io/folevi/folevi-server`, see `../docker/`) with one
persistent volume at `/data`. **Unverified: deploy each once before publishing a button or template.**

| Platform | File | Notes |
| --- | --- | --- |
| Coolify | `coolify/folevi.yaml` | Service template (docker-compose with Coolify's magic variables). Coolify's proxy serves HTTPS |
| Dokploy | `dokploy/docker-compose.yml` + `dokploy/template.toml` | Template for Dokploy's templates repository |
| Railway | `railway/railway.json` | Deploy from the image; add a volume at `/data` in the service settings (Railway volumes are not set in config) |
| Fly.io | `fly/fly.toml` | `fly launch --copy-config --no-deploy`, `fly volumes create folevi_data --size 10`, `fly deploy` |
| Render | `render/render.yaml` | Blueprint; a persistent disk needs a paid instance type |

Every platform puts its own HTTPS proxy in front. Folevi Server must then use the platform's public address as
its origin: these templates set `FOLEVI_PUBLIC_URL`, which folevid reads (server/folevid config). Folevi Connect
names under `folevi.app` are not needed on these platforms.

Volumes on Fly, Render and Railway are owned by root, so those templates use a two-line Dockerfile
(`FROM` the image, `USER root`): the image's entrypoint then fixes the owner of `/data` and drops to uid 10001
before folevid starts. folevid never runs as root.

Memory: give the service at least 1 GB (2 GB recommended); Folevi Server does not fit in 512 MB.
