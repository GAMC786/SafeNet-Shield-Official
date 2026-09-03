# SafeNet-Shield v1.0.15 Release Checklist

## Pre-Release Verification

- [x] GitHub repository write access confirmed
- [x] All open PRs reviewed and merged (PR #21, #22, #24, #25 merged)
- [x] Cross-platform CI/CD workflow validated
- [x] Release notes prepared
- [x] Security review complete (PIN lockout follow-up identified)

## Build & Release Process

### Step 1: Create Git Tag ✅
```bash
git tag v1.0.15
git push origin v1.0.15
```

### Step 2: GitHub Actions Automation (Automatic)
- [ ] Build Android APK (signed with keystore)
- [ ] Build Windows MSI (x64)
- [ ] Build Web assets
- [ ] Run Android smoke tests (API 34)
- [ ] Create GitHub Release with artifacts

### Step 3: Quality Assurance
- [ ] Verify APK integrity and signature
- [ ] Test MSI installation on Windows
- [ ] Validate web app functionality
- [ ] Check release notes are visible

### Step 4: Post-Release
- [ ] Monitor smoke test results
- [ ] Verify artifacts are accessible
- [ ] Update documentation if needed
- [ ] Create follow-up issue: "Implement persistent cross-server PIN lockouts"

## Blocking Issues

### ✅ RESOLVED: GitHub Repository Write Access
- Status: **UNBLOCKED**
- Permission Level: Admin + Push
- Verified: 2026-09-03

### ⏳ Post-Release Security Follow-up
- Issue: Persistent cross-server PIN lockout implementation
- Status: Scheduled for next sprint
- Priority: High (Security)

## Release Commands

### For Maintainers (Replit):
```bash
# Ensure on main branch with latest code
git checkout main
git pull origin main

# Create and push release tag
git tag v1.0.15
git push origin v1.0.15

# Monitor build at:
# https://github.com/GAMC786/SafeNet-Shield-Official/actions
```

---

**Release Coordinator**: Abdul Mahmood Ghazimal (GAMC786)  
**Date**: September 3, 2026  
**Version**: 1.0.15
