#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${WG_EASY_INSTALL_DIR:-/opt/wg-easy}"
COMPOSE_URL="https://raw.githubusercontent.com/wg-easy/wg-easy/master/docker-compose.yml"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root or with sudo." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine first: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "The Docker Compose plugin is required." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download the official WG-Easy compose file." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}"
curl --fail --location --proto '=https' --tlsv1.2 "${COMPOSE_URL}" \
  --output "${INSTALL_DIR}/docker-compose.yml"

docker compose --project-directory "${INSTALL_DIR}" up -d

cat <<EOF
WG-Easy is running.

Admin UI: http://<server-address>:51821
WireGuard endpoint: <server-address>:51820/udp
Persistent configuration: ${INSTALL_DIR}

Open UDP 51820 and TCP 51821 in the host firewall. Then set these SafeNet
server variables and restart SafeNet:
  WG_EASY_URL=https://<your-admin-host>
  WG_EASY_WIREGUARD_ENDPOINT=<your-vpn-host>:51820
EOF