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
clerk_origin="${ANDROID_BILLING_CLERK_ORIGIN:-${MOBILE_API_URL:-}}"
clerk_origin="${clerk_origin%/}"
storage_state="${AUTH_SMOKE_STORAGE_STATE:-}"
purchase_confirm_text="${ANDROID_BILLING_PURCHASE_CONFIRM_TEXT:-Buy}"
action="${ANDROID_BILLING_ACTION:-purchase}"
serial_args=()

fail() {
    echo "ERROR: $*" >&2
    exit 2
}

[[ -n "$clerk_origin" ]] || fail "ANDROID_BILLING_CLERK_ORIGIN or MOBILE_API_URL is required."
[[ "$action" == "purchase" || "$action" == "restore" ]] ||
    fail "ANDROID_BILLING_ACTION must be purchase or restore."
[[ "$(basename "$apk_path")" == "app-release.apk" ]] ||
    fail "Billing proof requires the explicitly named app-release.apk."
[[ "$(basename "$test_apk_path")" == "app-release-androidTest.apk" ]] ||
    fail "Billing proof requires the explicitly named app-release-androidTest.apk."
[[ -s "$apk_path" ]] || fail "Signed release APK was not found: $apk_path"
[[ -s "$test_apk_path" ]] || fail "Release instrumentation APK was not found: $test_apk_path"
command -v adb >/dev/null 2>&1 || fail "adb is required on the dedicated Play runner."
[[ -n "$storage_state" ]] || fail "AUTH_SMOKE_STORAGE_STATE is required for the Clerk-linked proof."

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

clerk_cookie_payload="$(
    AUTH_SMOKE_STORAGE_STATE="$storage_state" node --input-type=module - <<'NODE'
const raw = process.env.AUTH_SMOKE_STORAGE_STATE;
let state;
try {
  state = JSON.parse(raw);
} catch {
  console.error("AUTH_SMOKE_STORAGE_STATE is not valid JSON.");
  process.exit(1);
}
const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
const lines = cookies
  .filter((cookie) => typeof cookie?.name === "string" && typeof cookie?.value === "string")
  .map((cookie) => `${cookie.name}=${cookie.value}`);
if (lines.length === 0) {
  console.error("AUTH_SMOKE_STORAGE_STATE does not contain browser cookies.");
  process.exit(1);
}
process.stdout.write(Buffer.from(lines.join("\n"), "utf8").toString("base64"));
NODE
)" || fail "Could not prepare the Clerk session cookie payload."

adb install -r "$apk_path" > "$output_dir/install-app.log"
adb install -r "$test_apk_path" > "$output_dir/install-test-app.log"

set +e
adb shell am instrument -w -r \
    -e clerk-origin "$clerk_origin" \
    -e clerk-cookie-base64 "$clerk_cookie_payload" \
    -e billing-action "$action" \
    -e billing-purchase-confirm-text "$purchase_confirm_text" \
    -e billing-output-dir "$output_dir" \
    -e class com.safenet.dns.RevenueCatBillingInstrumentationTest#purchaseRestoreAndStatusStayLinked \
    "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 | tee "$output_dir/instrumentation.log"
instrumentation_status="${PIPESTATUS[0]}"
set -e

adb logcat -d -t 800 > "$output_dir/logcat.txt" 2>&1 || true
if [[ "$instrumentation_status" -ne 0 ]] ||
    ! grep -Fq "REVENUECAT_BILLING_PROOF result=PASS" "$output_dir/instrumentation.log"; then
    {
        printf 'apk=%s\nvalidation_mode=dedicated-play-runner\ndevice_kind=play-enabled-device\n' "$apk_path"
        printf 'purchase_action=%s\nresult=FAIL\n' "$action"
    } | tee "$output_dir/result.txt" >&2
    echo "RevenueCat Android purchase/restore proof failed." >&2
    exit "${instrumentation_status:-1}"
fi

{
    printf 'apk=%s\nvalidation_mode=dedicated-play-runner\ndevice_kind=play-enabled-device\n' "$apk_path"
    printf 'purchase_action=%s\nclerk_session=PASS\npurchase_or_restore=PASS\n' "$action"
    printf 'server_status=PASS\nresult=PASS\n'
} | tee "$output_dir/result.txt"