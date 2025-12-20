#!/bin/bash
# SafeNet DNS - Windows MSI Build Script

echo "================================"
echo "SafeNet DNS - Windows Build"
echo "================================"

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
npx electron-builder --win --x64

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
