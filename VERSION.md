# Versioning and Release Strategy

This document describes the versioning strategy and release process for SafeNet Shield.

## Semantic Versioning

SafeNet Shield follows [Semantic Versioning](https://semver.org/) (SemVer) for all releases:

```
vMAJOR.MINOR.PATCH
```

- **MAJOR** version - Incompatible API changes or major feature overhauls
- **MINOR** version - New functionality in a backwards-compatible manner
- **PATCH** version - Backwards-compatible bug fixes

### Examples:
- `v1.0.0` - Initial stable release
- `v1.1.0` - Added new features (backwards compatible)
- `v1.1.1` - Bug fixes only
- `v2.0.0` - Breaking changes or major redesign

## Creating a New Release

### Prerequisites
- Ensure all changes are merged to the `main` branch
- All tests pass and builds are successful
- Update CHANGELOG.md with release notes (if applicable)

### Release Process

1. **Create and push a version tag:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Automated build:**
   - GitHub Actions automatically triggers the release workflow
   - Builds Android APK (release version)
   - Creates a GitHub Release with the APK attached

3. **Verify the release:**
   - Go to https://github.com/GAMC786/SafeNet-Shield-Official/releases
   - Verify the new release appears with correct version
   - Confirm APK file is attached
   - Check auto-generated release notes

### Testing Pre-releases

For testing releases before official deployment, use pre-release tags:

```bash
git tag v1.0.0-beta
git push origin v1.0.0-beta
```

Or for release candidates:

```bash
git tag v1.0.0-rc.1
git push origin v1.0.0-rc.1
```

## Release Artifacts

Each release automatically includes:

**Android APK** - `SafeNet-Shield-v{version}.apk`
- Built using Capacitor
- Release build (production ready)
- Compatible with Android 8.0+

## Version Numbering Guidelines

### When to increment MAJOR version:
- Complete UI/UX redesign
- Breaking changes to DNS filtering rules
- Major architecture changes
- Removal of previously supported features

### When to increment MINOR version:
- New filtering categories
- New configuration options
- Performance improvements
- New platforms or deployment options

### When to increment PATCH version:
- Bug fixes
- Security patches
- Documentation updates
- Minor UI tweaks

## Rollback Strategy

If a release has critical issues:

1. Create a new patch release with fixes:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

2. Mark the problematic release as "pre-release" on GitHub
3. Add a warning note to the release description

## Notes

- Only repository maintainers can push tags to trigger releases
- The release workflow requires successful Android build
- Release notes are auto-generated from commit messages between releases
- Keep commit messages clear and descriptive for better release notes
