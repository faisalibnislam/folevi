# Folevi Server container image: the same bundle as every native package, run by folevid.
# Build context (made by packaging/docker/build.sh):
#   bundles/amd64/   bundle for linux/amd64     bundles/arm64/   bundle for linux/arm64
# Debian 12 has glibc 2.36 and GCC 12's libstdc++ (GLIBCXX_3.4.30), which the Convex backend needs
# (docs/self-hosting/PHASE0.md section 6), so runtime/lib is not used here.
FROM debian:12-slim

ARG TARGETARCH
ARG FOLEVI_VERSION=0.0.0

LABEL org.opencontainers.image.title="Folevi Server" \
      org.opencontainers.image.description="Your own Folevi server for your family or team." \
      org.opencontainers.image.url="https://folevi.com/server" \
      org.opencontainers.image.vendor="Folevi" \
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
    FOLEVI_PACKAGE=container

USER folevi
VOLUME ["/data"]
EXPOSE 8460 8443

# The web app's well-known file answers only when folevid, the backend and the web app are all up.
# Our own Node does the check, so the image needs no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["/opt/folevi/runtime/node/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.FOLEVI_PORT||8460)+'/.well-known/folevi.json').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

STOPSIGNAL SIGTERM
# Runs as uid 10001 by default. Run with user 0:0 only when the host makes /data as root: the entrypoint then
# fixes ownership and drops to FOLEVI_UID:FOLEVI_GID (docker-entrypoint.sh).
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/folevi-entrypoint"]
CMD ["run", "--data", "/data", "--bundle", "/opt/folevi"]
