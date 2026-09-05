# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS web-build

WORKDIR /build/source

COPY source/package.json source/package-lock.json source/.npmrc ./
COPY source/apps/web/package.json apps/web/package.json
COPY source/packages/contracts/package.json packages/contracts/package.json
COPY source/packages/core/package.json packages/core/package.json
COPY source/packages/storage/package.json packages/storage/package.json
COPY source/packages/sync/package.json packages/sync/package.json

RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY source/ ./

RUN npm run build --workspace @lastdone/web


FROM golang:1.27-alpine AS server-build

ARG TARGETOS=linux
ARG TARGETARCH

WORKDIR /build/server

COPY source/server/go.mod source/server/go.sum ./

RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY source/server/ ./

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/lastdone .


FROM alpine:3.22 AS runtime

ARG VERSION=dev

LABEL org.opencontainers.image.title="LastDone" \
      org.opencontainers.image.description="Private, offline-first recurring life tracker" \
      org.opencontainers.image.source="https://github.com/getl-x/lastdone" \
      org.opencontainers.image.version="${VERSION}"

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 lastdone \
    && adduser -S -D -H -u 10001 -G lastdone lastdone \
    && mkdir -p /pb/pb_data /pb/pb_public \
    && chown -R lastdone:lastdone /pb

COPY --from=server-build --chown=lastdone:lastdone /out/lastdone /usr/local/bin/lastdone
COPY --from=web-build --chown=lastdone:lastdone /build/source/apps/web/dist/ /pb/pb_public/

USER 10001:10001
WORKDIR /pb

ENV LASTDONE_DATA_DIR=/pb/pb_data \
    LASTDONE_PUBLIC_DIR=/pb/pb_public \
    LASTDONE_VERSION=${VERSION} \
    LASTDONE_VAPID_SUBJECT=https://example.com \
    GOMEMLIMIT=384MiB \
    TZ=Asia/Shanghai

VOLUME ["/pb/pb_data"]
EXPOSE 8090
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/usr/local/bin/lastdone", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/lastdone"]
CMD ["serve", "--http=0.0.0.0:8090"]
