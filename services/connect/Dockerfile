# Folevi Connect. Build from services/connect: docker build -t folevi-connect .
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/connect ./cmd/connect

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/connect /connect
ENV CONNECT_DB=/data/connect.db \
    CONNECT_ACME_CACHE_DIR=/data/acme \
    CONNECT_HTTP_ADDR=:8080 \
    CONNECT_RELAY_ADDR=:8443
EXPOSE 8080 8443
ENTRYPOINT ["/connect"]
