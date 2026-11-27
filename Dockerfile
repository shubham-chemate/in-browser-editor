# syntax=docker/dockerfile:1

# ---- 1. frontend: install deps, run tests, build static files -------------
FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Run with: docker build --target web-test .
FROM web-build AS web-test
RUN npm test

# ---- 2. server: build a static Go binary -----------------------------------
FROM golang:1.23-alpine AS server-build
WORKDIR /src
COPY server/go.mod ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server . && mkdir -p /out/data

# Run with: docker build --target server-test .
FROM server-build AS server-test
RUN go vet ./... && go test ./...

# ---- 3. runtime: just the binary + static files (~15 MB) -------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=server-build /out/server /app/server
COPY --from=web-build /web/dist /app/static
# A new named volume copies this directory's owner, so the nonroot user can write.
COPY --from=server-build --chown=65532:65532 /out/data /data
ENV ADDR=:8080 \
    STATIC_DIR=/app/static \
    DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["/app/server", "healthcheck"]
ENTRYPOINT ["/app/server"]
