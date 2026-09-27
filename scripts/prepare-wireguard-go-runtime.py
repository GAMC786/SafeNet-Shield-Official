#!/usr/bin/env python3
"""Apply SafeNet's suspend-aware CLOCK_BOOTTIME patch to a private Go root."""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NoReturn


GO_VERSION = "1.26.5"
MARKER_NAME = ".safenet-boottime-patch"


def fail(message: str) -> NoReturn:
    raise SystemExit(f"ERROR: {message}")


def toolchain_version(go_root: Path) -> str:
    go_binary = go_root / "bin" / "go"
    if not go_binary.is_file():
        fail(f"Go executable was not found in {go_root}.")
    try:
        result = subprocess.run(
            [str(go_binary), "version"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        fail(f"Could not read the Go toolchain version in {go_root}: {exc}")
    return result.stdout.strip()


def apply_rule(
    text: str,
    filename: str,
    label: str,
    old_pattern: str,
    new_pattern: str,
    replacement: str,
) -> str:
    old_count = len(re.findall(old_pattern, text, flags=re.MULTILINE))
    new_count = len(re.findall(new_pattern, text, flags=re.MULTILINE))
    if old_count == 1 and new_count == 0:
        updated, count = re.subn(
            old_pattern,
            replacement,
            text,
            count=1,
            flags=re.MULTILINE,
        )
        if count != 1:
            fail(f"Could not patch {label} in {filename}.")
        return updated
    if old_count == 0 and new_count == 1:
        return text
    fail(
        f"Expected one original or patched {label} in {filename}; "
        f"found {old_count} original and {new_count} patched occurrences."
    )


def patch_file(go_root: Path, filename: str, rules: list[tuple[str, str, str, str]]) -> None:
    path = go_root / "src" / "runtime" / filename
    if not path.is_file():
        fail(f"Go runtime source file was not found: {path}")
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(f"Could not read {path}: {exc}")

    updated = text
    for label, old_pattern, new_pattern, replacement in rules:
        updated = apply_rule(updated, filename, label, old_pattern, new_pattern, replacement)
    if updated != text:
        try:
            path.write_text(updated, encoding="utf-8")
        except OSError as exc:
            fail(f"Could not update {path}: {exc}")


def marker_contents(go_root: Path) -> str:
    digest = hashlib.sha256()
    files = (
        "sys_linux_386.s",
        "sys_linux_amd64.s",
        "sys_linux_arm.s",
        "sys_linux_arm64.s",
    )
    for filename in files:
        path = go_root / "src" / "runtime" / filename
        digest.update(filename.encode("ascii"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return (
        f"go_version={GO_VERSION}\n"
        "monotonic_clock=CLOCK_BOOTTIME\n"
        f"runtime_sources_sha256={digest.hexdigest()}\n"
    )


def main() -> None:
    if len(sys.argv) != 2:
        fail("Usage: prepare-wireguard-go-runtime.py <private-Go-root>")

    go_root = Path(sys.argv[1]).resolve()
    current_go = shutil.which("go")
    if current_go:
        try:
            current_root = subprocess.run(
                [current_go, "env", "GOROOT"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError) as exc:
            fail(f"Could not identify the installed Go root: {exc}")
        if go_root == Path(current_root).resolve():
            fail("Refusing to modify the active Go installation; use a private Go-root copy.")

    version_output = toolchain_version(go_root)
    if not re.search(rf"\bgo{re.escape(GO_VERSION)}(?:\s|$)", version_output):
        fail(f"Go {GO_VERSION} is required; found {version_output}.")

    rules_by_file = {
        "sys_linux_386.s": [
            (
                "VDSO monotonic clock",
                r"^([ \t]*)MOVL[ \t]+\$1,[ \t]*0\(SP\)[ \t]*//[ \t]*CLOCK_MONOTONIC[ \t]*$",
                r"^[ \t]*MOVL[ \t]+\$7,[ \t]*0\(SP\)[ \t]*//[ \t]*CLOCK_BOOTTIME[ \t]*$",
                r"\g<1>MOVL $7, 0(SP) // CLOCK_BOOTTIME",
            ),
            (
                "syscall fallback monotonic clock",
                r"^([ \t]*)MOVL[ \t]+\$1,[ \t]*BX[ \t]*//[ \t]*CLOCK_MONOTONIC[ \t]*$",
                r"^[ \t]*MOVL[ \t]+\$7,[ \t]*BX[ \t]*//[ \t]*CLOCK_BOOTTIME[ \t]*$",
                r"\g<1>MOVL $7, BX // CLOCK_BOOTTIME",
            ),
        ],
        "sys_linux_amd64.s": [
            (
                "monotonic clock",
                r"^([ \t]*)MOVL[ \t]+\$1,[ \t]*DI[ \t]*//[ \t]*CLOCK_MONOTONIC[ \t]*$",
                r"^[ \t]*MOVL[ \t]+\$7,[ \t]*DI[ \t]*//[ \t]*CLOCK_BOOTTIME[ \t]*$",
                r"\g<1>MOVL $7, DI // CLOCK_BOOTTIME",
            ),
        ],
        "sys_linux_arm.s": [
            (
                "monotonic clock",
                r"^([ \t]*)MOVW[ \t]+\$CLOCK_MONOTONIC,[ \t]*R0[ \t]*$",
                r"^[ \t]*MOVW[ \t]+\$7,[ \t]*R0[ \t]*//[ \t]*CLOCK_BOOTTIME[ \t]*$",
                r"\g<1>MOVW $7, R0 // CLOCK_BOOTTIME",
            ),
        ],
        "sys_linux_arm64.s": [
            (
                "monotonic clock",
                r"^([ \t]*)MOVW[ \t]+\$CLOCK_MONOTONIC,[ \t]*R0[ \t]*$",
                r"^[ \t]*MOVW[ \t]+\$7,[ \t]*R0[ \t]*//[ \t]*CLOCK_BOOTTIME[ \t]*$",
                r"\g<1>MOVW $7, R0 // CLOCK_BOOTTIME",
            ),
        ],
    }

    for filename, rules in rules_by_file.items():
        patch_file(go_root, filename, rules)

    marker = go_root / MARKER_NAME
    contents = marker_contents(go_root)
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=go_root,
            prefix=f"{MARKER_NAME}.",
            delete=False,
        ) as temp:
            temp.write(contents)
            temporary_marker = Path(temp.name)
        temporary_marker.replace(marker)
    except OSError as exc:
        fail(f"Could not write the SafeNet Go runtime marker in {go_root}: {exc}")

    print(f"Prepared Go {GO_VERSION} runtime with CLOCK_BOOTTIME in {go_root}.")


if __name__ == "__main__":
    main()