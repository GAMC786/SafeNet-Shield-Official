#!/usr/bin/env bash

# Keep install failure parsing separate from the device lane so it can be
# exercised with bounded, synthetic adb output. Never pass logcat through this
# parser: adb install output is the only source of the recorded outcome.

sanitize_android_install_outcome() {
    local raw_output="${1:-}"
    local sanitized

    sanitized="$(
        printf '%s' "$raw_output" |
            tr '\r\n\t' '   ' |
            sed -E \
                -e 's#(^|[[:space:]])(/[[:graph:]]+|[A-Za-z]:\\[^[:space:]]*)#\1<path>#g' \
                -e 's#((authorization|bearer|token|password|secret|api[_-]?key|cookie)[[:space:]]*[=:][[:space:]]*)[^[:space:]]+#\1<redacted>#Ig' \
                -e 's#(Bearer[[:space:]]+)[^[:space:]]+#\1<redacted>#Ig' |
            tr -s ' ' |
            sed -E 's/^ +| +$//g'
    )"

    # adb should return a short install response, but keep the evidence bounded
    # if a future platform tool emits an unexpectedly large response.
    if [[ "${#sanitized}" -gt 4096 ]]; then
        sanitized="${sanitized:0:4096}"
    fi
    printf '%s' "${sanitized:-NO_OUTPUT}"
}

classify_android_install_failure() {
    local raw_output="${1:-}"
    local exit_status="${2:-1}"
    local package_manager_category

    package_manager_category="$(
        grep -Eo 'INSTALL(_PARSE)?_FAILED_[A-Z0-9_]+' <<<"$raw_output" |
            tail -n 1 || true
    )"
    if [[ -n "$package_manager_category" ]]; then
        printf '%s\n' "$package_manager_category"
    elif grep -Eiq 'no space left|insufficient storage|not enough space' <<<"$raw_output"; then
        printf 'INSTALL_FAILED_INSUFFICIENT_STORAGE\n'
    elif grep -Eiq 'device[[:space:]]+offline|device offline' <<<"$raw_output"; then
        printf 'ADB_DEVICE_OFFLINE\n'
    elif grep -Eiq 'unauthorized' <<<"$raw_output"; then
        printf 'ADB_DEVICE_UNAUTHORIZED\n'
    elif [[ "$exit_status" -eq 124 ]]; then
        printf 'ADB_INSTALL_TIMEOUT\n'
    else
        printf 'ADB_INSTALL_FAILURE\n'
    fi
}