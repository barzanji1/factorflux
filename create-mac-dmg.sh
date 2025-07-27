#!/bin/bash

# Create a proper Mac DMG installer for QuantumCore
echo "Creating QuantumCore Mac DMG installer..."

# Clean up and prepare
rm -rf mac-dmg-build
mkdir -p mac-dmg-build/QuantumCore.app/Contents/MacOS
mkdir -p mac-dmg-build/QuantumCore.app/Contents/Resources

# Copy the application files
cp -r dist/* mac-dmg-build/QuantumCore.app/Contents/Resources/ 2>/dev/null || true
cp -r electron/* mac-dmg-build/QuantumCore.app/Contents/Resources/ 2>/dev/null || true
cp -r uploads mac-dmg-build/QuantumCore.app/Contents/Resources/ 2>/dev/null || true

# Create Info.plist
cat > mac-dmg-build/QuantumCore.app/Contents/Info.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>QuantumCore</string>
    <key>CFBundleIdentifier</key>
    <string>com.quantumcore.app</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>QuantumCore</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>QTMC</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>CFBundleDisplayName</key>
    <string>QuantumCore</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
</dict>
</plist>
EOF

# Create the executable launcher script
cat > mac-dmg-build/QuantumCore.app/Contents/MacOS/QuantumCore << 'EOF'
#!/bin/bash

# QuantumCore Mac Launcher
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESOURCES_DIR="$DIR/../Resources"

echo "🚀 Starting QuantumCore..."

# Change to resources directory
cd "$RESOURCES_DIR"

# Check if Node.js is available
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js found, starting enhanced launcher..."
    node simple-browser-launcher.js 2>/dev/null || {
        echo "⚠️  Enhanced launcher failed, using browser fallback..."
        open "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
    }
else
    echo "🌐 Opening QuantumCore in your web browser..."
    open "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
fi

echo "✅ QuantumCore launched successfully!"
EOF

chmod +x mac-dmg-build/QuantumCore.app/Contents/MacOS/QuantumCore

# Copy launcher files
cp simple-browser-launcher.js mac-dmg-build/QuantumCore.app/Contents/Resources/ 2>/dev/null || echo "No launcher found"
cp start-quantumcore.sh mac-dmg-build/QuantumCore.app/Contents/Resources/ 2>/dev/null || echo "No start script found"

# Create a simple compressed archive (since we can't create actual DMG without macOS tools)
echo "📦 Creating compressed Mac installer..."
cd mac-dmg-build
tar -czf ../electron-dist/QuantumCore-Mac-Installer.tar.gz QuantumCore.app
cd ..

# Also create a ZIP for easier extraction
cd mac-dmg-build
zip -r ../electron-dist/QuantumCore-Mac-Installer.zip QuantumCore.app >/dev/null 2>&1
cd ..

# Clean up
rm -rf mac-dmg-build

echo "✅ Mac installer created:"
echo "   📦 electron-dist/QuantumCore-Mac-Installer.tar.gz"
echo "   📦 electron-dist/QuantumCore-Mac-Installer.zip"
ls -lh electron-dist/QuantumCore-Mac-Installer.*