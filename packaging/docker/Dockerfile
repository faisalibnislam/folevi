# Folevi Server container image: the same bundle as every native package, run by folevid.
# Build context (made by packaging/docker/build.sh):
#   bundles/amd64/   bundle for linux/amd64     bundles/arm64/   bundle for linux/arm64
# Debian 12 has glibc 2.36 and GCC 12's libstdc++ (GLIBCXX_3.4.30), which the Convex backend needs
# (docs/self-hosting/PHASE0.md section 6), so runtime/lib is not used here.
FROM debian:12-slim

ARG TARGETARCH
ARG FOLEVI_VERSION=0.0.0

LABEL org.opencontainers.image.title="Folevi Server" \
      org.opencontainers.image.description="Your own Folevi server (Beta) for your family or team." \
      org.opencontainers.image.url="https://folevi.com/server" \
      org.opencontainers.image.vendor="Space Cherries LLC" \
      org.opencontainers.image.version="${FOLEVI_VERSION}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 folevi \
 && useradd --system --uid 10001 --gid folevi --home-dir /data --no-create-home --shell /usr/sbin/nologin folevi \
 && install -d -o folevi -g folevi -m 0750 /data

COPY --chown=root:root bundles/${TARGETARCH}/ /opt/folevi/
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/folevi-entrypoint

ENV FOLEVI_DATA=/data \
    FOLEVI_BUNDLE=/opt/folevi \
    FOLEVI_PACKAGE=container \
    FOLEVI_MANAGED_BY=store

USER folevi
VOLUME ["/data"]
EXPOSE 8460 8443

# "folevid healthcheck" exits 0 when the backend and the web app are running, so the image needs no curl.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
  CMD ["/opt/folevi/bin/folevid", "healthcheck", "--data", "/data"]

STOPSIGNAL SIGTERM
# Runs as uid 10001 by default. Run with user 0:0 only when the host makes /data as root: the entrypoint then
# fixes ownership and drops to FOLEVI_UID:FOLEVI_GID (docker-entrypoint.sh).
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/folevi-entrypoint"]
CMD ["run", "--data", "/data", "--bundle", "/opt/folevi"]
