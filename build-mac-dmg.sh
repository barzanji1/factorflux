#!/bin/bash

# Build Mac DMG installer for FactorFlux
echo "🚀 Building FactorFlux Mac DMG installer..."

# Step 1: Build the application
echo "📦 Building application..."
npm run build

# Step 2: Copy necessary files for electron build
echo "📋 Preparing electron build..."
mkdir -p desktop-build
cp -r dist/* desktop-build/ 2>/dev/null || true
cp -r electron/* desktop-build/ 2>/dev/null || true
cp -r uploads desktop-build/ 2>/dev/null || true
cp package.json desktop-build/

# Step 3: Create electron package.json for building
cat > desktop-build/package.json << 'EOF'
{
  "name": "factorflux",
  "version": "1.0.0",
  "description": "FactorFlux - Freight Factoring Management System",
  "main": "main.js",
  "author": "Trucking Pros Financial",
  "license": "MIT",
  "homepage": "https://factorflux.app"
}
EOF

# Step 4: Build DMG using electron-builder
echo "🔨 Building DMG installer..."
cd desktop-build
npx electron-builder --mac --config ../electron-builder.json

# Step 5: Move DMG to main directory
echo "📦 Finalizing DMG..."
cd ..
if [ -f "desktop-build/dist/FactorFlux-*.dmg" ]; then
    cp desktop-build/dist/FactorFlux-*.dmg electron-dist/FactorFlux-Mac.dmg
    echo "✅ DMG created successfully: electron-dist/FactorFlux-Mac.dmg"
    ls -lh electron-dist/FactorFlux-Mac.dmg
else
    echo "❌ DMG build failed"
    ls -la desktop-build/dist/ 2>/dev/null || echo "No dist directory found"
fi

echo "🏁 Build process completed!"