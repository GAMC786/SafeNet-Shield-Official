#!/bin/bash
# SafeNet DNS - Android APK Build Script

echo "================================"
echo "SafeNet DNS - Android Build"
echo "================================"

# Step 1: Build web application
echo ""
echo "[1/3] Building web application..."
npm run build

if [ $? -ne 0 ]; then
    echo "ERROR: Web build failed!"
    exit 1
fi

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
