# 🍎 QuantumCore Mac Installation Instructions

## What You Get
- **QuantumCore-Mac-Installer.tar.gz** (5.5 MB)
- Native Mac .app bundle with proper macOS integration
- Professional installer with Info.plist configuration
- Cross-platform launcher with browser fallback

## Installation Steps

### 1. Download the Installer
```
Download: /api/desktop/download/mac
```

### 2. Extract the Archive
```bash
# Double-click the .tar.gz file in Finder, or use Terminal:
tar -xzf QuantumCore-Mac-Installer.tar.gz
```

### 3. Install the Application
```bash
# Move to Applications folder (recommended)
mv QuantumCore.app /Applications/

# Or run from current directory
open QuantumCore.app
```

### 4. Launch QuantumCore
- **Finder:** Go to Applications → Double-click QuantumCore
- **Spotlight:** Press ⌘+Space → Type "QuantumCore" → Press Enter
- **Terminal:** `open /Applications/QuantumCore.app`

## What Happens When You Launch

1. **Enhanced Mode** (if Node.js is installed):
   - Uses advanced browser launcher
   - Optimized performance and features

2. **Standard Mode** (browser fallback):
   - Opens QuantumCore in your default web browser
   - Full functionality available
   - No additional software required

## Troubleshooting

### "QuantumCore.app" can't be opened
```bash
# Remove quarantine attribute (macOS security)
xattr -d com.apple.quarantine /Applications/QuantumCore.app
```

### Permission Denied
```bash
# Fix permissions
chmod +x /Applications/QuantumCore.app/Contents/MacOS/QuantumCore
```

### App Won't Launch
1. Try right-click → Open (instead of double-click)
2. Check System Preferences → Security & Privacy → Allow apps from identified developers
3. Use Terminal: `open /Applications/QuantumCore.app`

## Manual Browser Access
If the app doesn't work, you can always access QuantumCore directly:
```
https://your-app-domain.replit.app
```

## Technical Details
- **Bundle ID:** com.quantumcore.app
- **Minimum macOS:** 10.15 (Catalina)
- **Architecture:** Universal (Intel + Apple Silicon)
- **File Size:** 5.5 MB
- **Dependencies:** None (browser-based)

## Support
The Mac installer is a native .app bundle that launches QuantumCore in your web browser, providing the best of both worlds: native macOS integration with web-based functionality.