#!/bin/bash
# SafeNet DNS - Android APK Build Script

echo "================================"
echo "SafeNet DNS - Android Build"
echo "================================"

# The APK contains the web frontend, not the Express server. API requests must
# target a separately deployed HTTPS backend.
if [ -z "${MOBILE_API_URL:-}" ]; then
    echo "ERROR: MOBILE_API_URL is required."
    echo "Example: MOBILE_API_URL=https://your-server.example.com ./scripts/build-android.sh"
    exit 1
fi

echo "Checking backend settings endpoint..."
if ! VITE_API_URL=$(node scripts/validate-mobile-api.mjs "$MOBILE_API_URL"); then
    exit 1
fi
export VITE_API_URL

echo "Mobile backend: $VITE_API_URL"

# Step 1: Build web application
echo ""
echo "[1/3] Building web application..."
npm run build

if [ $? -ne 0 ]; then
    echo "ERROR: Web build failed!"
    exit 1
fi

cat > dist/public/mobile-build.json <<EOF
{
  "apiOrigin": "$VITE_API_URL",
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

# Step 2: Sync to Android
echo ""
echo "[2/3] Syncing to Android project..."
npx cap sync android

if [ $? -ne 0 ]; then
    echo "ERROR: Capacitor sync failed!"
    exit 1
fi

# Step 3: Check if we can build
echo ""
echo "[3/3] Android project ready!"
echo ""
echo "To build the APK:"
echo "  Option A: Open in Android Studio"
echo "    npx cap open android"
echo ""
echo "  Option B: Build from command line (requires Android SDK)"
echo "    cd android && ./gradlew assembleDebug"
echo ""
echo "APK output location:"
echo "  android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "For release builds, configure signing in android/app/build.gradle"
echo "================================"
