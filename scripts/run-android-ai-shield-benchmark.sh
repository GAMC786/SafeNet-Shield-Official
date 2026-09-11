#!/usr/bin/env bash
set -euo pipefail

# Runs only the offline AI Shield benchmark. It generates deterministic
# synthetic fixtures in the Android test process; no camera or screen frames
# are read, written, or uploaded.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/android"

TEST_CLASS="com.safenet.dns.AiShieldClassifierInstrumentationTest#bundledModelBenchmarkReportsMetricsPerVersion"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is required. Connect an Android device or start an emulator first." >&2
  exit 1
fi

if ! adb get-state >/dev/null 2>&1; then
  echo "No Android device or emulator is available." >&2
  exit 1
fi

./gradlew :app:connectedAndroidTest \
  -x verifyMobileWebAssets \
  "-Pandroid.testInstrumentationRunnerArguments.class=${TEST_CLASS}"

echo
echo "Benchmark completed. To print the machine-readable per-version report:"
echo "  adb logcat -d -s AiShieldBenchmark:I '*:S' | grep AI_SHIELD_BENCHMARK"