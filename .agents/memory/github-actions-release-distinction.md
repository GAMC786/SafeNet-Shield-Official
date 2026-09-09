---
name: GitHub Actions artifacts versus releases
description: A successful Actions artifact upload does not create a visible GitHub Release or attach release assets.
---

GitHub Actions artifacts and GitHub Releases are separate publishing mechanisms. A release workflow must explicitly create a release for the tag and upload the APK (or provide a deliberate release-download path); an `actions/upload-artifact` step alone only stores a run artifact.

**Why:** A signed APK workflow completed successfully while the corresponding version tag still had no entry under GitHub Releases.

**How to apply:** When a user expects a version under GitHub Releases, verify the releases API and ensure the workflow or release process creates the release object and uploads the APK/checksum assets.