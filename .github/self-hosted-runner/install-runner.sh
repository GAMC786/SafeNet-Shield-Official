#!/usr/bin/env bash
set -euo pipefail

# install-runner.sh
# Usage:
#   sudo GITHUB_PAT=ghp_... ./install-runner.sh --repo GAMC786/SafeNet-Shield-Official --name safe-runner-01 --labels linux,x64,self-hosted
# Or if you prefer to supply the registration token (from the UI):
#   sudo RUNNER_TOKEN=... ./install-runner.sh --repo GAMC786/SafeNet-Shield-Official --name safe-runner-01 --labels linux,x64,self-hosted

REPO="GAMC786/SafeNet-Shield-Official"
RUNNER_USER="actions-runner"
INSTALL_DIR="/home/${RUNNER_USER}/actions-runner"
WORK_DIR="_work"
RUNNER_NAME="$(hostname)-runner"
LABELS="linux,x64,self-hosted"

usage(){
  cat <<EOF
Usage: sudo [GITHUB_PAT=your_pat | RUNNER_TOKEN=token] ./install-runner.sh [--repo owner/repo] [--name runner-name] [--labels label1,label2]

Notes:
 - If you provide GITHUB_PAT (a Personal Access Token with repo:admin or appropriate scope), the script will create
   the registration token via GitHub API automatically. Otherwise provide RUNNER_TOKEN with the short-lived token
   you obtain from the repo Settings → Actions → Runners → New self-hosted runner page.
 - Run this script with sudo (it will create a dedicated user and set ownership).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --name) RUNNER_NAME="$2"; shift 2;;
    --labels) LABELS="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1"; usage; exit 1;;
  esac
done

REPO_OWNER=${REPO%%/*}
REPO_NAME=${REPO#*/}

if [[ $(id -u) -ne 0 ]]; then
  echo "This script must be run with sudo/root. Re-run using: sudo $0 ..."
  exit 1
fi

# Ensure required tools exist
require_cmd(){
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command '$1' not found. Attempting to install (apt/yum/pacman supported)..."
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update && apt-get install -y "$1"
    elif command -v yum >/dev/null 2>&1; then
      yum install -y "$1"
    elif command -v pacman >/dev/null 2>&1; then
      pacman -Sy --noconfirm "$1"
    else
      echo "Please install $1 and re-run the script." >&2
      exit 1
    fi
  fi
}

require_cmd curl
require_cmd tar
# jq is optional but recommended for robust JSON parsing
if ! command -v jq >/dev/null 2>&1; then
  echo "Warning: 'jq' not found. The script will try to parse JSON with sed/grep fallback. Install jq for best results."
fi

# Create dedicated user if it doesn't exist
if ! id -u "${RUNNER_USER}" >/dev/null 2>&1; then
  echo "Creating user ${RUNNER_USER}"
  useradd --comment 'GitHub Actions Runner' --create-home --shell /bin/bash "${RUNNER_USER}"
fi

mkdir -p "${INSTALL_DIR}"
chown -R "${RUNNER_USER}:" "${INSTALL_DIR}"

cd "${INSTALL_DIR}"

# Download latest runner release
echo "Fetching latest actions/runner release..."
if command -v jq >/dev/null 2>&1; then
  TAG=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name)
else
  TAG=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | grep -m1 '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
fi
if [[ -z "$TAG" ]]; then
  echo "Failed to fetch latest runner tag" >&2
  exit 1
fi
VERSION=${TAG#v}
ASSET="actions-runner-linux-x64-${VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/${TAG}/${ASSET}"

echo "Downloading ${ASSET} from ${URL}"
curl -fsSLO "$URL"

echo "Extracting..."
tar xzf "$ASSET" -C "${INSTALL_DIR}"
chown -R "${RUNNER_USER}:" "${INSTALL_DIR}"

# Obtain registration token
TOKEN=""
if [[ -n "${GITHUB_PAT:-}" ]]; then
  echo "Using GITHUB_PAT to create registration token via GitHub API..."
  API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runners/registration-token"
  if command -v jq >/dev/null 2>&1; then
    TOKEN=$(curl -fsS -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer ${GITHUB_PAT}" "$API_URL" | jq -r .token)
  else
    TOKEN=$(curl -fsS -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer ${GITHUB_PAT}" "$API_URL" | grep -m1 '"token":' | sed -E 's/.*"([^"]+)".*/\1/')
  fi
  if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    echo "Failed to create registration token using GITHUB_PAT. Ensure the PAT has repo scope or admin:repo_hook where required." >&2
    exit 1
  fi
elif [[ -n "${RUNNER_TOKEN:-}" ]]; then
  TOKEN="${RUNNER_TOKEN}"
else
  echo "No GITHUB_PAT or RUNNER_TOKEN provided. Please create a registration token at:"
  echo "  https://github.com/${REPO_OWNER}/${REPO_NAME}/settings/actions/runners/new?arch=x64&os=linux"
  echo "Then run the script with RUNNER_TOKEN=the_token"
  exit 1
fi

# Configure runner as the dedicated user
sudo -u "${RUNNER_USER}" -H bash -c "cd ${INSTALL_DIR} && ./config.sh --unattended --url https://github.com/${REPO_OWNER}/${REPO_NAME} --token ${TOKEN} --name \"${RUNNER_NAME}\" --work ${WORK_DIR} --labels \"${LABELS}\""

# Install service and start
echo "Installing service..."
cd "${INSTALL_DIR}"
./svc.sh install
./svc.sh start

echo "Runner installed and started. Verify in repository Settings → Actions → Runners."

cat <<EOF
Post-install notes:
 - If you used GITHUB_PAT to create the registration token, consider revoking the PAT if it was created just for this purpose.
 - To remove the runner: stop and uninstall the service with ./svc.sh stop && ./svc.sh uninstall, then run ./config.sh remove --token <remove-token>
EOF
