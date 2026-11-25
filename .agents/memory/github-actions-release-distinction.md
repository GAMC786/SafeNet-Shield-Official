---
name: GitHub Actions artifacts versus releases
description: A successful Actions artifact upload does not create a visible GitHub Release or attach release assets.
---

GitHub Actions artifacts and GitHub Releases are separate publishing mechanisms. A release workflow must explicitly create a release for the tag and upload the APK (or provide a deliberate release-download path); an `actions/upload-artifact` step alone only stores a run artifact.

**Why:** A signed APK workflow completed successfully while the corresponding version tag still had no entry under GitHub Releases.

**How to apply:** When a user expects a version under GitHub Releases, verify the releases API and ensure the workflow or release process creates the release object and uploads the APK/checksum assets.

If the hosted release action returns an empty HTTP 500 while creating a new release, first verify the signed APK and checksum artifacts. In this repository, pushing the exact annotated tag and using `gh release create --verify-tag` with `GITHUB_RELEASE_TOKEN` succeeded where the action and REST release endpoint failed.

**Why:** The APK build and signatures were valid; the failure was isolated to release creation, and a pre-existing tag let the authenticated GitHub CLI publish the verified artifacts without rebuilding.

**How to apply:** Use this only after confirming the workflow's package/version/signature checks and artifact checksum. Create the tag at the exact build commit, publish the APK and checksum with the opaque `GH_TOKEN` handoff, then download the release assets and verify the checksum. Never print or inspect the token.