#!/bin/sh
# Runs the browser smoke test entirely in Docker against a throwaway app
# container (empty anonymous volume), so your real snippets are never touched.
# Screenshots land in e2e/screenshots/.
set -eu
cd "$(dirname "$0")/.."

PW_VERSION=1.49.1
NET=snippet-editor-e2e
APP=snippet-editor-e2e-app

docker compose build editor
docker network create "$NET" >/dev/null 2>&1 || true
docker rm -f "$APP" >/dev/null 2>&1 || true
docker run -d --rm --name "$APP" --network "$NET" --network-alias editor -v /data snippet-editor:latest >/dev/null
trap 'docker rm -f "$APP" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true' EXIT

mkdir -p e2e/screenshots
docker run --rm --network "$NET" --ipc=host \
  -v "$PWD/e2e:/e2e" -v snippet-editor-e2e-nm:/e2e/node_modules -w /e2e \
  -e SHOTS_DIR=/e2e/screenshots \
  "mcr.microsoft.com/playwright:v${PW_VERSION}-noble" \
  sh -c "[ -d node_modules/playwright ] || npm install --no-save --no-audit --no-fund playwright@${PW_VERSION} >/dev/null; node smoke.mjs"
