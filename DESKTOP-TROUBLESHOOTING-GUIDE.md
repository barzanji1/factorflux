# QuantumCore Desktop Launcher Troubleshooting Guide

## Updated Desktop Launchers (January 26, 2025)

The desktop launchers have been completely updated to resolve launch failures. Here's what's been improved:

### ✅ What's Fixed

1. **Better Browser Detection**: Multiple fallback methods for opening browsers
2. **Enhanced Error Handling**: Clear messages when browser can't be opened automatically
3. **Cross-Platform Compatibility**: Improved scripts for Windows, Mac, and Linux
4. **Professional User Experience**: Better visual feedback and instructions
5. **Dual Launcher System**: Node.js enhanced launcher with basic fallback

### 🚀 How the New Launchers Work

#### Windows (`start-quantumcore.bat`)
- Checks if Node.js is available for enhanced experience
- Falls back to basic Windows `start` command
- Provides clear desktop app creation instructions
- Works without any dependencies

#### Mac (`start-quantumcore.sh`)
- Uses `open` command (built into macOS)
- Provides Safari "Add to Dock" and Chrome "Create Shortcut" instructions
- No external dependencies required

#### Linux (`start-quantumcore.sh`)
- Uses `xdg-open` (standard on most Linux distributions)
- Falls back to Firefox or Chrome if available
- Provides desktop launcher creation instructions

### 📱 Desktop App Experience

Users can create a true "desktop app" experience by:

**Chrome/Edge:**
1. Open QuantumCore in browser
2. Go to "More Tools" > "Create Shortcut"
3. Check "Open as window"
4. Name it "QuantumCore"

**Safari (Mac):**
1. Open QuantumCore in Safari
2. Click "Share" > "Add to Dock"
3. Name it "QuantumCore"

**Firefox:**
1. Right-click on page
2. Select "Create Desktop Shortcut"

### 🔧 If Launchers Still Don't Work

**Windows:**
- Double-click `start-quantumcore.bat`
- If that fails, manually open: `https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev`

**Mac:**
- Double-click `start-quantumcore.sh`
- If permission denied: `chmod +x start-quantumcore.sh`
- If that fails, manually open the URL in Safari/Chrome

**Linux:**
- Double-click `start-quantumcore.sh` or run `./start-quantumcore.sh`
- If permission denied: `chmod +x start-quantumcore.sh`
- If that fails, run: `xdg-open https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev`

### 📋 Manual Access

If all else fails, users can always access QuantumCore directly:
- **Live URL**: https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev
- **Bookmark this URL** for instant access
- **Add to browser favorites** for easy access

### 🛠️ Technical Details

The new launchers include:
- **Enhanced Node.js launcher** (`simple-browser-launcher.js`) for better experience
- **Basic fallback methods** that work without any dependencies
- **Professional visual feedback** with emojis and clear instructions
- **Platform-specific guidance** for creating desktop shortcuts
- **Error handling** with manual URL fallback

### 📦 Updated Installers

All desktop installers have been rebuilt with:
- ✅ Fixed launcher scripts
- ✅ Proper file permissions
- ✅ Enhanced user experience
- ✅ Better error messages
- ✅ Clear setup instructions

Download the updated installers:
- **Windows**: QuantumCore-Windows-Portable.tar.gz
- **Mac**: QuantumCore-Mac-Portable.tar.gz  
- **Linux**: QuantumCore-Linux-Portable.tar.gz

### 💡 Pro Tips

1. **Bookmark the URL** for fastest access
2. **Create browser shortcuts** for desktop app experience
3. **Use web version** if desktop launchers have issues
4. **Check browser security settings** if automatic opening fails
5. **Try different browsers** if one doesn't work

The desktop experience is now reliable and professional, with multiple fallback methods ensuring QuantumCore always launches successfully.