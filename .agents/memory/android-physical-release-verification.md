---
name: Physical release verification boundary
description: How tagged Android releases distinguish signed APK publication from real physical WireGuard verification
---

Tagged Android releases may publish the signed APK even when the manually dispatched physical-device lane has no available runner or no usable evidence. The release must report that state as a bounded blocker, not as physical verification.

**Why:** A hosted smoke pass and a valid signature do not prove that a real phone established the WireGuard gateway handshake. Treating missing physical evidence as a pass creates a false release claim.

**How to apply:** Resolve only a completed physical workflow run on the exact release ref and commit. Require each expected device profile to report explicit device and physical evidence, match the signed APK digest, and record the real gateway handshake before reporting PASS. Publish the evidence-run link and blocker state alongside the APK without making APK publication depend on the phone runner.

Physical-device checks must also create a bounded `BLOCKED` evidence directory when runner setup or ADB discovery prevents the test from starting. The always-run upload path should preserve the release identity, ADB/device diagnostics, and exact infrastructure blocker without converting the missing phone into a pass.

**Why:** A skipped test otherwise leaves maintainers with no downloadable evidence and makes hardware availability indistinguishable from an unreported regression.

**How to apply:** Keep preflight and device-discovery blockers distinct from application `FAIL` results, retain bounded diagnostics even when no serial is available, and upload the report from an `always()` path.