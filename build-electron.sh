#!/bin/bash

echo "Building QuantumCore Desktop Application..."

# Step 1: Build the web application
echo "Step 1: Building web application..."
npm run build

# Step 2: Copy necessary files for Electron
echo "Step 2: Preparing Electron files..."
mkdir -p electron-dist
cp -r dist electron-dist/
cp -r electron electron-dist/
cp -r uploads electron-dist/ 2>/dev/null || echo "No uploads directory found, skipping..."

# Step 3: Create a simplified package.json for Electron
echo "Step 3: Creating Electron package.json..."
cat > electron-dist/package.json << EOF
{
  "name": "quantumcore-desktop",
  "version": "1.0.0",
  "description": "QuantumCore - Freight Factoring Management System",
  "author": "Trucking Pros Financial",
  "main": "electron/main.js",
  "scripts": {
    "start": "node dist/index.js"
  }
}
EOF

# Step 4: Build the desktop app
echo "Step 4: Building desktop application..."
npx electron-builder --config electron-builder.json

echo "Desktop application built successfully!"
echo "Check the 'electron-dist' folder for the installer files."