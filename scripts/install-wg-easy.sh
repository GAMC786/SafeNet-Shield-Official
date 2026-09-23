#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${WG_EASY_INSTALL_DIR:-/opt/wg-easy}"
PROJECT_NAME="${WG_EASY_PROJECT_NAME:-wg-easy}"
COMPOSE_URL="${WG_EASY_COMPOSE_URL:-https://raw.githubusercontent.com/wg-easy/wg-easy/master/docker-compose.yml}"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"
CONFIGURE_FIREWALL="${WG_EASY_CONFIGURE_FIREWALL:-1}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "WG-Easy must be installed on a Linux host with Docker networking support." >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root or with sudo." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
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
chmod 700 "${INSTALL_DIR}"

temporary_compose="$(mktemp "${INSTALL_DIR}/docker-compose.yml.XXXXXX")"
trap 'rm -f "${temporary_compose}"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 "${COMPOSE_URL}" \
  --output "${temporary_compose}"

if ! grep -Fq "/etc/wireguard" "${temporary_compose}"; then
  echo "The downloaded compose file does not persist /etc/wireguard." >&2
  exit 1
fi

for required_mapping in '51820:51820/udp' '51821:51821/tcp'; do
  if ! grep -Fq "\"${required_mapping}\"" "${temporary_compose}"; then
    echo "The downloaded compose file is missing the ${required_mapping} port mapping." >&2
    exit 1
  fi
done

install -m 600 "${temporary_compose}" "${COMPOSE_FILE}"

compose() {
  docker compose \
    --project-directory "${INSTALL_DIR}" \
    --project-name "${PROJECT_NAME}" \
    "$@"
}

compose config >/dev/null

if [[ "${CONFIGURE_FIREWALL}" == "1" ]]; then
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 51820/udp comment "WG-Easy WireGuard" >/dev/null
    ufw allow 51821/tcp comment "WG-Easy admin UI" >/dev/null
  elif command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port=51820/udp >/dev/null
    firewall-cmd --permanent --add-port=51821/tcp >/dev/null
    firewall-cmd --reload >/dev/null
  else
    echo "Warning: no supported firewall command found; open UDP 51820 and TCP 51821 manually." >&2
  fi
fi

compose up -d

if ! compose ps --status running --services | grep -Fxq "wg-easy"; then
  echo "WG-Easy did not remain running. Recent container status:" >&2
  compose ps >&2
  exit 1
fi

volume_name="${PROJECT_NAME}_etc_wireguard"
if ! docker volume inspect "${volume_name}" >/dev/null 2>&1; then
  echo "WG-Easy started without the expected persistent ${volume_name} volume." >&2
  exit 1
fi

admin_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 10 http://127.0.0.1:51821 || true)"
if [[ ! "${admin_status}" =~ ^[23][0-9][0-9]$ ]]; then
  echo "WG-Easy admin UI did not respond locally on TCP 51821 (HTTP ${admin_status:-no response})." >&2
  exit 1
fi

cat <<EOF
WG-Easy is running with persistent WireGuard state.

Admin UI: http://<server-address>:51821
WireGuard endpoint: <server-address>:51820/udp
Persistent configuration: ${INSTALL_DIR}
Docker volume: ${volume_name}

Verify that the host provider also allows UDP 51820 and TCP 51821. Then set these
SafeNet workspace variables and restart SafeNet:
  WG_EASY_URL=https://<your-admin-host>
  WG_EASY_WIREGUARD_ENDPOINT=<your-vpn-host>:51820
EOF