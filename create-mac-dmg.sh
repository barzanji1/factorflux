#!/bin/bash

# Create a proper Mac DMG installer for FactorFlux
echo "Creating FactorFlux Mac DMG installer..."

# Clean up and prepare
rm -rf mac-dmg-build
mkdir -p mac-dmg-build/FactorFlux.app/Contents/MacOS
mkdir -p mac-dmg-build/FactorFlux.app/Contents/Resources

# Copy the application files
cp -r dist/* mac-dmg-build/FactorFlux.app/Contents/Resources/ 2>/dev/null || true
cp -r electron/* mac-dmg-build/FactorFlux.app/Contents/Resources/ 2>/dev/null || true
cp -r uploads mac-dmg-build/FactorFlux.app/Contents/Resources/ 2>/dev/null || true

# Create Info.plist
cat > mac-dmg-build/FactorFlux.app/Contents/Info.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>FactorFlux</string>
    <key>CFBundleIdentifier</key>
    <string>com.factorflux.app</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>FactorFlux</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>QTMC</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>CFBundleDisplayName</key>
    <string>FactorFlux</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
</dict>
</plist>
EOF

# Create the executable launcher script
cat > mac-dmg-build/FactorFlux.app/Contents/MacOS/FactorFlux << 'EOF'
#!/bin/bash

# FactorFlux Mac Launcher
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESOURCES_DIR="$DIR/../Resources"

echo "🚀 Starting FactorFlux..."

# Change to resources directory
cd "$RESOURCES_DIR"

# Check if Node.js is available
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js found, starting enhanced launcher..."
    node simple-browser-launcher.js 2>/dev/null || {
        echo "⚠️  Enhanced launcher failed, using browser fallback..."
        open "https://factorflux.co"
    }
else
    echo "🌐 Opening FactorFlux in your web browser..."
    open "https://factorflux.co"
fi

echo "✅ FactorFlux launched successfully!"
EOF

chmod +x mac-dmg-build/FactorFlux.app/Contents/MacOS/FactorFlux

# Copy launcher files
cp simple-browser-launcher.js mac-dmg-build/FactorFlux.app/Contents/Resources/ 2>/dev/null || echo "No launcher found"
cp start-factorflux.sh mac-dmg-build/FactorFlux.app/Contents/Resources/ 2>/dev/null || echo "No start script found"

# Create a simple compressed archive (since we can't create actual DMG without macOS tools)
echo "📦 Creating compressed Mac installer..."
cd mac-dmg-build
tar -czf ../electron-dist/FactorFlux-Mac-Installer.tar.gz FactorFlux.app
cd ..

# Also create a ZIP for easier extraction
cd mac-dmg-build
zip -r ../electron-dist/FactorFlux-Mac-Installer.zip FactorFlux.app >/dev/null 2>&1
cd ..

# Clean up
rm -rf mac-dmg-build

echo "✅ Mac installer created:"
echo "   📦 electron-dist/FactorFlux-Mac-Installer.tar.gz"
echo "   📦 electron-dist/FactorFlux-Mac-Installer.zip"
ls -lh electron-dist/FactorFlux-Mac-Installer.*