#!/bin/bash
# SafeNet DNS - Windows MSI Build Script

echo "================================"
echo "SafeNet DNS - Windows Build"
echo "================================"

# The MSI contains the web frontend and loads it from file://. API requests
# must target a separately deployed HTTPS backend.
if [ -z "${DESKTOP_API_URL:-}" ]; then
    echo "ERROR: DESKTOP_API_URL is required."
    echo "Example: DESKTOP_API_URL=https://your-server.example.com ./scripts/build-windows.sh"
    exit 1
fi

echo "Checking backend settings endpoint..."
if ! VITE_API_URL=$(node scripts/validate-mobile-api.mjs "$DESKTOP_API_URL"); then
    exit 1
fi
export VITE_API_URL

echo "Windows backend: $VITE_API_URL"

# Step 1: Build web application
echo ""
echo "[1/2] Building web application..."
npm run build

if [ $? -ne 0 ]; then
    echo "ERROR: Web build failed!"
    exit 1
fi

# Step 2: Build Electron app
echo ""
echo "[2/2] Building Windows installer..."
npx electron-builder --win --x64 --publish never

if [ $? -ne 0 ]; then
    echo "ERROR: Electron build failed!"
    echo "Note: Windows builds work best on Windows OS"
    exit 1
fi

echo ""
echo "================================"
echo "Build complete!"
echo ""
echo "Output files:"
echo "  MSI: dist-electron/SafeNet DNS Setup *.msi"
echo "  EXE: dist-electron/SafeNet DNS Setup *.exe"
echo "================================"
