# How to Download QuantumCore Desktop App

## Quick Start for Users

### Windows Users:
1. Download `QuantumCore-Setup.exe`
2. Double-click to install
3. Launch from Start Menu or Desktop shortcut

### Mac Users:
1. Download `QuantumCore.dmg`
2. Open the DMG file
3. Drag QuantumCore to Applications folder
4. Launch from Applications or Launchpad

### Linux Users:
1. Download `QuantumCore.AppImage`
2. Make it executable: `chmod +x QuantumCore.AppImage`
3. Double-click to run

## Building the Desktop App (For Administrators)

To create the downloadable installers:

1. **Build the application:**
   ```bash
   ./build-electron.sh
   ```

2. **Find the installers in the `electron-dist` folder:**
   - Windows: `QuantumCore Setup.exe`
   - Mac: `QuantumCore.dmg`
   - Linux: `QuantumCore.AppImage`

3. **Distribute these files to your users**

## Testing During Development

To test the desktop app while developing:

```bash
./run-electron-dev.sh
```

This will start both the server and Electron app for testing.

## Benefits of Desktop Version

✓ **Offline Access**: Works without browser
✓ **Faster Performance**: Native desktop speed
✓ **Easy Installation**: Standard app installation
✓ **Desktop Integration**: Taskbar, notifications, file associations
✓ **Security**: Harder to tamper with than web apps
✓ **Professional Feel**: Looks like enterprise software

## System Requirements

- **Windows**: Windows 10 or later
- **Mac**: macOS 10.15 (Catalina) or later
- **Linux**: Most modern distributions (Ubuntu 18+, etc.)
- **RAM**: 4GB minimum
- **Storage**: 500MB free space
- **Internet**: Required for database access

The desktop app connects to the same database as the web version, so all your data stays synchronized!