#!/bin/bash

echo "🚀 Building QuantumCore Desktop Installers..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf electron-dist
rm -rf desktop-build

# Step 1: Build the web application
echo "📱 Step 1: Building web application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Web build failed!"
    exit 1
fi

# Step 2: Create desktop build directory
echo "📁 Step 2: Setting up desktop build..."
mkdir -p desktop-build

# Copy built web files
cp -r dist desktop-build/
cp -r electron desktop-build/
cp -r uploads desktop-build/ 2>/dev/null || echo "No uploads directory found"

# Create desktop package.json
cat > desktop-build/package.json << EOF
{
  "name": "quantumcore-desktop",
  "version": "1.0.0",
  "description": "QuantumCore - Freight Factoring Management System",
  "author": "Trucking Pros Financial",
  "main": "electron/main.js",
  "homepage": "./",
  "scripts": {
    "start": "electron ."
  }
}
EOF

# Step 3: Try to build installers (will work best on actual desktop systems)
echo "💿 Step 3: Building desktop installers..."

cd desktop-build

# For Replit environment, we'll create portable versions
echo "📦 Creating portable application..."

# Create Windows portable (will work when downloaded)
mkdir -p ../electron-dist/win-portable
cp -r * ../electron-dist/win-portable/

# Create Mac portable  
mkdir -p ../electron-dist/mac-portable
cp -r * ../electron-dist/mac-portable/

# Create Linux portable
mkdir -p ../electron-dist/linux-portable  
cp -r * ../electron-dist/linux-portable/

# Create startup scripts
cat > ../electron-dist/win-portable/start-quantumcore.bat << 'EOF'
@echo off
echo Starting QuantumCore...
node dist/index.js
pause
EOF

cat > ../electron-dist/mac-portable/start-quantumcore.sh << 'EOF'
#!/bin/bash
echo "Starting QuantumCore..."
node dist/index.js
EOF

cat > ../electron-dist/linux-portable/start-quantumcore.sh << 'EOF'
#!/bin/bash
echo "Starting QuantumCore..."
node dist/index.js
EOF

chmod +x ../electron-dist/mac-portable/start-quantumcore.sh
chmod +x ../electron-dist/linux-portable/start-quantumcore.sh

cd ..

# Step 4: Create download packages
echo "📦 Step 4: Creating download packages..."

# Create ZIP files for easy distribution
cd electron-dist
zip -r QuantumCore-Windows-Portable.zip win-portable/
zip -r QuantumCore-Mac-Portable.zip mac-portable/  
zip -r QuantumCore-Linux-Portable.zip linux-portable/
cd ..

echo "✅ Desktop build completed!"
echo ""
echo "📁 Files created in electron-dist/:"
ls -la electron-dist/
echo ""
echo "🎉 Ready for distribution:"
echo "   • QuantumCore-Windows-Portable.zip - For Windows users"
echo "   • QuantumCore-Mac-Portable.zip - For Mac users" 
echo "   • QuantumCore-Linux-Portable.zip - For Linux users"
echo ""
echo "📧 Users can download, extract, and run the start script!"