#!/bin/sh
# UI lab: a throwaway app server (empty volume, seeded with sample snippets)
# plus a live-reloading Vite dev server on the current ./web sources.
# Nothing touches your real snippets.
#
#   ./e2e/lab.sh up               start (idempotent)
#   ./e2e/lab.sh shoot <script>   run e2e/lab/<script>.mjs in Playwright; screenshots -> e2e/screenshots/lab/
#   ./e2e/lab.sh down             stop and remove everything
set -eu
cd "$(dirname "$0")/.."

NET=se-lab
APP=se-lab-app
WEB=se-lab-web
PW_VERSION=1.49.1

up() {
  docker network create "$NET" >/dev/null 2>&1 || true
  if ! docker ps --format '{{.Names}}' | grep -qx "$APP"; then
    docker image inspect snippet-editor:latest >/dev/null 2>&1 || docker compose build editor
    docker rm -f "$APP" >/dev/null 2>&1 || true
    docker run -d --name "$APP" --network "$NET" --network-alias editor -v /data snippet-editor:latest >/dev/null
  fi
  if ! docker ps --format '{{.Names}}' | grep -qx "$WEB"; then
    docker rm -f "$WEB" >/dev/null 2>&1 || true
    docker run -d --name "$WEB" --network "$NET" --network-alias web \
      -v "$PWD/web:/app" -v snippet-editor-web-nm:/app/node_modules -w /app \
      -e API_TARGET=http://editor:8080 -p 127.0.0.1:5174:5173 \
      node:22-alpine sh -c "npm ci --no-audit --no-fund >/dev/null 2>&1; npx vite --host 0.0.0.0 --port 5173" >/dev/null
  fi
  # wait for vite
  i=0
  until docker run --rm --network "$NET" curlimages/curl:8.10.1 -sf http://web:5173/ >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -gt 90 ] && { echo "vite did not start"; docker logs "$WEB" | tail -20; exit 1; }
    sleep 1
  done
  echo "lab up: http://web:5173 inside network $NET (also http://localhost:5174 on this machine)"
}

shoot() {
  script="${1:?usage: lab.sh shoot <script-name-without-.mjs>}"
  mkdir -p e2e/screenshots/lab
  docker run --rm --network "$NET" --ipc=host \
    -v "$PWD/e2e:/e2e" -v snippet-editor-e2e-nm:/e2e/node_modules -w /e2e \
    -e BASE_URL=http://web:5173 -e API_URL=http://editor:8080 -e SHOTS_DIR=/e2e/screenshots/lab \
    "mcr.microsoft.com/playwright:v${PW_VERSION}-noble" \
    sh -c "[ -d node_modules/playwright ] || npm install --no-save --no-audit --no-fund playwright@${PW_VERSION} >/dev/null 2>&1; node lab/${script}.mjs"
}

down() {
  docker rm -fv "$APP" "$WEB" >/dev/null 2>&1 || true # -v: drop the lab's throwaway data volume too
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "lab down"
}

case "${1:-}" in
  up) up ;;
  shoot) shift; shoot "$@" ;;
  down) down ;;
  *) echo "usage: $0 up|shoot <script>|down"; exit 2 ;;
esac
