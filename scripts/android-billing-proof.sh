#!/usr/bin/env bash
set -Eeuo pipefail

readonly PACKAGE_NAME="com.safenet.dns"
readonly TEST_PACKAGE_NAME="${PACKAGE_NAME}.test"
readonly TEST_RUNNER="androidx.test.runner.AndroidJUnitRunner"
readonly DEFAULT_APK="artifacts/android/app-release.apk"
readonly DEFAULT_TEST_APK="artifacts/android-test/app-release-androidTest.apk"

apk_path="${ANDROID_BILLING_APK:-$DEFAULT_APK}"
test_apk_path="${ANDROID_BILLING_TEST_APK:-$DEFAULT_TEST_APK}"
output_dir="${ANDROID_BILLING_OUTPUT_DIR:-android/app/build/reports/android-billing/latest}"
auth0_origin="${ANDROID_BILLING_AUTH0_ORIGIN:-${MOBILE_API_URL:-}}"
auth0_origin="${auth0_origin%/}"
storage_state="${AUTH0_SMOKE_STORAGE_STATE:-}"
purchase_confirm_text="${ANDROID_BILLING_PURCHASE_CONFIRM_TEXT:-Buy}"
action="${ANDROID_BILLING_ACTION:-purchase}"
preflight_timeout_seconds="${ANDROID_BILLING_PREFLIGHT_TIMEOUT_SECONDS:-20}"

fail() {
    echo "ERROR: $*" >&2
    exit 2
}

[[ -n "$auth0_origin" ]] ||
    fail "ANDROID_BILLING_AUTH0_ORIGIN or MOBILE_API_URL is required for the Auth0 billing session."
[[ -n "$storage_state" ]] ||
    fail "AUTH0_SMOKE_STORAGE_STATE repository secret is required for the Auth0 billing session."
[[ "$action" == "purchase" || "$action" == "restore" ]] ||
    fail "ANDROID_BILLING_ACTION must be purchase or restore."
[[ "$(basename "$apk_path")" == "app-release.apk" ]] ||
    fail "Billing proof requires the explicitly named app-release.apk."
[[ "$(basename "$test_apk_path")" == "app-release-androidTest.apk" ]] ||
    fail "Billing proof requires the explicitly named app-release-androidTest.apk."
[[ -s "$apk_path" ]] || fail "Signed release APK was not found: $apk_path"
[[ -s "$test_apk_path" ]] || fail "Release instrumentation APK was not found: $test_apk_path"
command -v adb >/dev/null 2>&1 || fail "adb is required on the dedicated Play runner."
[[ "$preflight_timeout_seconds" =~ ^[1-9][0-9]*$ ]] ||
    fail "ANDROID_BILLING_PREFLIGHT_TIMEOUT_SECONDS must be a positive integer."

mkdir -p "$output_dir"
rm -f "$output_dir"/*

if ! adb get-state 2>/dev/null | grep -qx "device"; then
    fail "The dedicated Android billing runner has no ready device."
fi
if ! adb shell pm path com.android.vending >/dev/null 2>&1; then
    fail "Google Play Store is not installed; billing proof requires a Play-enabled device."
fi
if ! adb shell dumpsys account 2>/dev/null | grep -Eiq "com.google|Account"; then
    fail "No configured Google Play account was found on the billing runner."
fi

auth0_localstorage_payload="$(
    AUTH0_SMOKE_STORAGE_STATE="$storage_state" node --input-type=module - <<'NODE'
const raw = process.env.AUTH0_SMOKE_STORAGE_STATE;
let state;
try {
  state = JSON.parse(raw);
} catch {
  console.error("AUTH0_SMOKE_STORAGE_STATE is not valid JSON.");
  process.exit(1);
}
const entries = (Array.isArray(state?.origins) ? state.origins : [])
  .flatMap((origin) => Array.isArray(origin?.localStorage) ? origin.localStorage : [])
  .filter((entry) => typeof entry?.name === "string" &&
    entry.name.startsWith("@@auth0spajs@@") &&
    typeof entry?.value === "string");
const hasAccessToken = entries.some((entry) => {
  try { return typeof JSON.parse(entry.value)?.access_token === "string"; }
  catch { return false; }
});
if (entries.length === 0 || !hasAccessToken) {
  console.error("AUTH0_SMOKE_STORAGE_STATE must contain an Auth0 access-token cache.");
  process.exit(1);
}
process.stdout.write(Buffer.from(JSON.stringify(entries), "utf8").toString("base64"));
NODE
)" || fail "Could not prepare the Auth0 local-storage cache."

run_configuration_preflight() {
    PREFLIGHT_ORIGIN="$auth0_origin" \
        AUTH0_CACHE_BASE64="$auth0_localstorage_payload" \
        PREFLIGHT_TIMEOUT_SECONDS="$preflight_timeout_seconds" \
        node --input-type=module - <<'NODE'
const origin = process.env.PREFLIGHT_ORIGIN;
const encodedCache = process.env.AUTH0_CACHE_BASE64;
const timeoutSeconds = Number(process.env.PREFLIGHT_TIMEOUT_SECONDS);
const entries = JSON.parse(Buffer.from(encodedCache, "base64").toString("utf8"));
const accessToken = entries.map((entry) => {
  try { return JSON.parse(entry.value)?.access_token; }
  catch { return null; }
}).find((value) => typeof value === "string");
if (!accessToken) {
  console.error("Auth0 storage state does not contain an access token.");
  process.exit(1);
}
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

try {
  const response = await fetch(`${origin}/api/billing/preflight`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: controller.signal,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.ready !== true) {
    console.error(
      payload?.message ||
        "RevenueCat billing configuration is not ready for the Android test account.",
    );
    process.exit(1);
  }
  process.stdout.write("RevenueCat billing configuration preflight: PASS\n");
} catch (error) {
  if (error?.name === "AbortError") {
    console.error(
      `RevenueCat billing configuration preflight timed out after ${timeoutSeconds} seconds.`,
    );
  } else {
    console.error("RevenueCat billing configuration preflight could not be completed.");
  }
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
NODE
}

if ! run_configuration_preflight; then
    {
        printf 'apk=%s\nvalidation_mode=dedicated-play-runner\ndevice_kind=play-enabled-device\n' "$apk_path"
        printf 'configuration_preflight=FAIL\npurchase_action=%s\nresult=FAIL\n' "$action"
    } | tee "$output_dir/result.txt" >&2
    fail "RevenueCat billing configuration preflight failed; purchase dialog was not launched."
fi

configuration_preflight="PASS"

adb install -r "$apk_path" > "$output_dir/install-app.log"
adb install -r "$test_apk_path" > "$output_dir/install-test-app.log"

redact_billing_output() {
    sed -E \
        -e 's/("?([Cc]ustomer[_ -]?[Ii][Dd]|app[_ -]?[Uu]ser[_ -]?[Ii][Dd]|auth0[_ -]?[Uu]ser[_ -]?[Ii][Dd]|authorization|bearer|token|secret|api[_ -]?[Kk]ey)"?[[:space:]]*:[[:space:]]*)"[^"]*"/\1"[REDACTED]"/g' \
        -e 's/(([Cc]ustomer[_ -]?[Ii][Dd]|app[_ -]?[Uu]ser[_ -]?[Ii][Dd]|auth0[_ -]?[Uu]ser[_ -]?[Ii][Dd]|authorization|bearer|token|secret|api[_ -]?[Kk]ey)[=:][[:space:]]*)[^[:space:],;)}]+/\1[REDACTED]/g' \
        -e 's/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[REDACTED_EMAIL]/g'
}

set +e
adb shell am instrument -w -r \
    -e billing-output-dir "$output_dir" \
    -e class com.safenet.dns.RevenueCatBillingInstrumentationTest#signedOutBillingRecoversFromAuth0StartupStall \
    "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 | redact_billing_output | tee "$output_dir/recovery-instrumentation.log"
recovery_instrumentation_status="${PIPESTATUS[0]}"
set -e

if [[ "$recovery_instrumentation_status" -ne 0 ]] ||
    ! grep -Fq "REVENUECAT_BILLING_RECOVERY_PROOF result=PASS" "$output_dir/recovery-instrumentation.log"; then
    {
        printf 'apk=%s\nvalidation_mode=dedicated-play-runner\ndevice_kind=play-enabled-device\n' "$apk_path"
        printf 'configuration_preflight=%s\naccount_recovery=FAIL\npurchase_action=%s\nresult=FAIL\n' \
            "$configuration_preflight" "$action"
    } | tee "$output_dir/result.txt" >&2
    echo "RevenueCat Android Billing account recovery proof failed." >&2
    exit "${recovery_instrumentation_status:-1}"
fi

set +e
adb shell am instrument -w -r \
    -e auth0-localstorage-base64 "$auth0_localstorage_payload" \
    -e billing-action "$action" \
    -e billing-purchase-confirm-text "$purchase_confirm_text" \
    -e billing-output-dir "$output_dir" \
    -e class com.safenet.dns.RevenueCatBillingInstrumentationTest#purchaseRestoreAndStatusStayLinked \
    "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 | redact_billing_output | tee "$output_dir/instrumentation.log"
instrumentation_status="${PIPESTATUS[0]}"
set -e

adb logcat -d -t 800 2>&1 | redact_billing_output > "$output_dir/logcat.txt" || true
if [[ "$instrumentation_status" -ne 0 ]] ||
    ! grep -Fq "REVENUECAT_BILLING_PROOF result=PASS" "$output_dir/instrumentation.log"; then
    {
        printf 'apk=%s\nvalidation_mode=dedicated-play-runner\ndevice_kind=play-enabled-device\n' "$apk_path"
        printf 'configuration_preflight=%s\naccount_recovery=PASS\npurchase_action=%s\nresult=FAIL\n' \
            "$configuration_preflight" "$action"
    } | tee "$output_dir/result.txt" >&2
    echo "RevenueCat Android purchase/restore proof failed." >&2
    exit "${instrumentation_status:-1}"
fi

{
    printf 'apk=%s\nvalidation_mode=dedicated-play-runner\ndevice_kind=play-enabled-device\n' "$apk_path"
    printf 'configuration_preflight=%s\naccount_recovery=PASS\npurchase_action=%s\n' \
        "$configuration_preflight" "$action"
    printf 'auth0_session=PASS\npurchase_or_restore=PASS\n'
    printf 'server_status=PASS\nresult=PASS\n'
} | tee "$output_dir/result.txt"