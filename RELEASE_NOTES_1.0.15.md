# SafeNet-Shield v1.0.15 Release Notes

**Release Date:** September 3, 2026

## ✨ New Features

### Cross-Platform Support
- ✅ **Android APK** - Signed release build with DNS-over-TCP and IPv6 support
- ✅ **Windows MSI** - Electron-based installer for Windows x64
- ✅ **Web Release** - Full TypeScript/React web application

### DNS Enhancements
- TCP/IPv6 DNS routing support
- IPv6 UDP packet forwarding
- DNS-over-TCP handling with upstream fallback
- Plain-DNS TCP fallback for compatibility

### VPN Improvements
- Standard DNS VPN traffic support
- Clean VPN revocation and state management
- Comprehensive instrumentation coverage

## 🐛 Fixes

- Fixed Android release compilation issues
- Improved Android preflight test determinism on Windows
- Enhanced DNS alert recovery resilience
- Centralized workflow lint matrix for cross-platform consistency

## 🔐 Security Notes

### Current Release
- Release APK signed with secure keystore
- Windows MSI built with GH_TOKEN signing

### Known Issues & Follow-ups
- **Cross-server PIN lockouts**: Main security focus for post-release hardening
  - Implement persistent PIN lockout tracking across servers
  - Add rate limiting for PIN attempts
  - Enhanced audit logging for authentication failures

## 📊 Testing

- Android emulator smoke tests (API 34, Google APIs)
- Public DNS resolver validation
- Instrumentation test suite included
- Windows build validation

## 🚀 Build & Release Process

This release uses GitHub Actions automation:
1. Tag push (`v1.0.15`) triggers build workflow
2. All platforms built and tested simultaneously
3. Artifacts attached to GitHub Release
4. Release notes published automatically

## 📥 Downloads

Once released, artifacts will be available at:
- **APK**: GitHub Releases > SafeNet-DNS-Android
- **MSI**: GitHub Releases > SafeNet-DNS-Windows
- **Web**: https://safe-net-shield-official.replit.app/

## 🙏 Contributors

- Abdul Mahmood Ghazimal (GAMC786)
- Replit Agent (CI/CD automation)

---

**Next Major Focus:** Persistent cross-server PIN lockout implementation for enhanced security.
