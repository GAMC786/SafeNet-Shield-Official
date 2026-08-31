#!/usr/bin/env bash
#
# Run the release-critical Android smoke test against one API 33+ emulator or
# connected device. The script intentionally uses adb/UIAutomator for the
# permission dialog, then runs the network assertions as instrumentation tests.
#
# Usage:
#   npm run android:smoke -- --apk android/app/build/outputs/apk/debug/app-debug.apk --reset-data
#
set -Eeuo pipefail

readonly PACKAGE_NAME="com.safenet.dns"
readonly EVIDENCE_ROOT="${ANDROID_SMOKE_EVIDENCE_DIR:-android/app/build/android-smoke}"
readonly UI_REMOTE="/sdcard/safenet-smoke-ui.xml"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APK="${ANDROID_SMOKE_APK:-$REPO_ROOT/android/app/build/outputs/apk/debug/app-debug.apk}"
TEST_APK="${ANDROID_SMOKE_TEST_APK:-$REPO_ROOT/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk}"
RESET_DATA=false
SKIP_INSTALL=false
SERIAL="${ADB_SERIAL:-}"

usage() {
  cat <<'EOF'
Usage: scripts/android-smoke-test.sh [options]

Options:
  --apk PATH          APK to install (default: android/app/build/outputs/apk/debug/app-debug.apk)
  --serial SERIAL     adb device/emulator serial (default: ADB_SERIAL or the only connected device)
  --reset-data        Clear SafeNet DNS app data before the run (required for a clean EULA gate)
  --skip-install      Reuse the installed APK
  -h, --help          Show this help

If app data is reset, finish the normal SafeNet DNS sign-in flow when prompted.
The selected backend must be reachable from the Android target.
EOF
}

while (($#)); do
  case "$1" in
    --apk)
      [[ $# -ge 2 ]] || { echo "ERROR: --apk requires a path." >&2; exit 2; }
      APK="$2"
      shift 2
      ;;
    --serial)
      [[ $# -ge 2 ]] || { echo "ERROR: --serial requires a device serial." >&2; exit 2; }
      SERIAL="$2"
      shift 2
      ;;
    --reset-data)
      RESET_DATA=true
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cd "$REPO_ROOT"
mkdir -p "$EVIDENCE_ROOT"
readonly EVIDENCE_FILE="$EVIDENCE_ROOT/run.log"
readonly UI_XML="$EVIDENCE_ROOT/ui.xml"
: > "$EVIDENCE_FILE"

exec > >(tee -a "$EVIDENCE_FILE") 2>&1

step=0
pass() {
  step=$((step + 1))
  echo "PASS [$step] $*"
}

fail() {
  echo "FAIL $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "FAIL smoke test aborted at line $line. Evidence: $EVIDENCE_FILE" >&2
}
trap 'on_error "$LINENO"' ERR
on_exit() {
  local status="$?"
  if (( status != 0 )); then
    echo "RESULT: FAIL"
    echo "Evidence: $EVIDENCE_ROOT"
  fi
}
trap on_exit EXIT

command -v adb >/dev/null 2>&1 || fail "adb is not installed or not on PATH."
command -v python3 >/dev/null 2>&1 || fail "python3 is required to read UIAutomator bounds."
[[ -f "$APK" ]] || fail "APK not found: $APK"
if [[ "$RESET_DATA" == true && "$SKIP_INSTALL" == true ]]; then
  fail "--reset-data cannot be combined with --skip-install; reinstall to reset VPN consent."
fi

mapfile -t devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
if [[ -z "$SERIAL" ]]; then
  [[ "${#devices[@]}" -eq 1 ]] || fail "Connect exactly one API 33+ device/emulator or pass --serial."
  SERIAL="${devices[0]}"
else
  printf '%s\n' "${devices[@]}" | grep -Fxq "$SERIAL" \
    || fail "adb target is not connected and ready: $SERIAL"
fi

adb_target() {
  adb -s "$SERIAL" "$@"
}

api_level="$(adb_target shell getprop ro.build.version.sdk | tr -d '\r')"
[[ "$api_level" =~ ^[0-9]+$ ]] || fail "Could not read Android API level from $SERIAL."
(( api_level >= 33 )) || fail "Android API $api_level is unsupported; use API 33 or newer."
pass "Connected to $SERIAL (Android API $api_level)."

if [[ "$SKIP_INSTALL" == false ]]; then
  if [[ "$RESET_DATA" == true ]]; then
    # Android stores VPN consent outside the app's SharedPreferences. An
    # uninstall is needed to make the permission-dialog check deterministic.
    adb_target shell am force-stop "$PACKAGE_NAME"
    adb_target uninstall "$PACKAGE_NAME" >/dev/null 2>&1 || true
  fi
  adb_target install -r "$APK"
  pass "Installed $(basename "$APK")."
else
  pass "Reusing the installed APK."
fi

if [[ "$RESET_DATA" == true ]]; then
  echo "WARNING: --reset-data clears this test target's SafeNet DNS app data and VPN consent."
  adb_target shell pm clear "$PACKAGE_NAME" | tee -a "$EVIDENCE_FILE"
  pass "Cleared app data and VPN consent for a clean EULA state."
else
  echo "NOTE: app data was preserved; use --reset-data to prove the first-run EULA gate."
fi

dump_ui() {
  adb_target shell uiautomator dump "$UI_REMOTE" >/dev/null
  adb_target exec-out cat "$UI_REMOTE" > "$UI_XML"
}

find_bounds() {
  local needle="$1"
  python3 - "$UI_XML" "$needle" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, needle = sys.argv[1:]
root = ET.parse(path).getroot()
for node in root.iter("node"):
    if node.attrib.get("text") == needle or node.attrib.get("content-desc") == needle:
        match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
        if match:
            left, top, right, bottom = map(int, match.groups())
            print((left + right) // 2, (top + bottom) // 2)
            break
PY
}

has_node() {
  dump_ui
  [[ -n "$(find_bounds "$1")" ]]
}

wait_for_node() {
  local needle="$1"
  local timeout="${2:-30}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if has_node "$needle"; then
      return 0
    fi
    sleep 1
  done
  echo "Last UIAutomator tree:" >&2
  cat "$UI_XML" >&2
  return 1
}

tap_node() {
  local needle="$1"
  dump_ui
  local point
  point="$(find_bounds "$needle")"
  [[ -n "$point" ]] || fail "Could not find UI control: $needle"
  read -r x y <<< "$point"
  adb_target shell input tap "$x" "$y"
}

tap_first_node() {
  local needle
  for needle in "$@"; do
    if has_node "$needle"; then
      tap_node "$needle"
      return 0
    fi
  done
  fail "Could not find any of: $*"
}

launch_app() {
  adb_target shell am force-stop "$PACKAGE_NAME"
  adb_target shell monkey -p "$PACKAGE_NAME" 1 >/dev/null
}

launch_app
(
  cd android
  ./gradlew :app:connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.safenet.dns.SafeNetVpnEulaTest
) | tee "$EVIDENCE_ROOT/eula-test.txt"
pass "Native plugin rejected starting before EULA acceptance."

launch_app
if ! wait_for_node "Settings" 30; then
  echo "Complete SafeNet DNS sign-in on the target, then rerun or continue from the Settings screen." >&2
  [[ -t 0 ]] || fail "Settings is unavailable; an authenticated app session is required."
  read -r -p "After sign-in is complete, press Enter to continue: "
  wait_for_node "Settings" 30 || fail "Settings did not appear after sign-in."
fi
pass "Opened an authenticated SafeNet DNS session."

tap_node "Settings"
wait_for_node "Enable DNS Protection VPN" 20
wait_for_node "Ready to protect DNS" 20
tap_node "Enable DNS Protection VPN"
wait_for_node "SafeNet DNS VPN End User License Agreement" 10
pass "Starting before EULA acceptance opened the required EULA gate."

tap_node "I have read and agree to this EULA, including the DNS-only scope and limitations described above."
tap_node "Accept and continue"
pass "Accepted the current EULA."

if wait_for_node "Connection request" 5 || wait_for_node "OK" 5 || wait_for_node "Allow" 5; then
  tap_first_node "OK" "Allow"
  pass "Completed the Android VPN permission flow."
else
  wait_for_node "Protected and connected" 30 || fail "VPN permission dialog did not appear and protection did not start."
  pass "Reused the already-granted Android VPN permission."
fi

wait_for_node "Protected and connected" 30
pass "VPN status reported Protected and connected."
dump_ui
cp "$UI_XML" "$EVIDENCE_ROOT/active-ui.xml"
grep -q "Resolver:" "$UI_XML" || fail "The active resolver was not shown in the protected state."
pass "Captured the selected resolver in the active-state evidence."

adb_target shell ping -c 1 -W 5 example.com | tee "$EVIDENCE_ROOT/dns-query.txt"
grep -Eq "PING[[:space:]]+example\.com[[:space:]]+\(|bytes from|1 packets transmitted, 1 (packets )?received|1 received" "$EVIDENCE_ROOT/dns-query.txt" \
  || fail "DNS query did not resolve example.com."
pass "Resolved example.com through the active DNS path."

(cd android && ./gradlew :app:assembleDebugAndroidTest) \
  | tee "$EVIDENCE_ROOT/traffic-build.txt"
[[ -f "$TEST_APK" ]] || fail "Instrumentation APK not found: $TEST_APK"
adb_target install -r "$TEST_APK" | tee "$EVIDENCE_ROOT/traffic-install.txt"
adb_target shell am instrument -w -r \
  -e class com.safenet.dns.SafeNetVpnTrafficTest \
  com.safenet.dns.test/androidx.test.runner.AndroidJUnitRunner \
  | tee "$EVIDENCE_ROOT/https-test.txt"
pass "Ordinary HTTPS traffic passed while DNS protection was active."

tap_node "Enable DNS Protection VPN"
wait_for_node "Ready to protect DNS" 20
if has_node "Protected and connected"; then
  fail "VPN status remained active after stop."
fi
pass "Stopped protection and confirmed the VPN status cleared."

echo "RESULT: PASS"
echo "Evidence: $EVIDENCE_ROOT"