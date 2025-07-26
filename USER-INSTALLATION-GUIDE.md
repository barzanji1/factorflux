# QuantumCore Desktop Installation Guide

## 🎯 Quick Start for Users

### Step 1: Download QuantumCore
Choose the version for your operating system:

- **Windows**: Download `QuantumCore-Windows-Portable.tar.gz`
- **Mac**: Download `QuantumCore-Mac-Portable.tar.gz`
- **Linux**: Download `QuantumCore-Linux-Portable.tar.gz`

### Step 2: Extract the Files
- **Windows**: Use 7-Zip, WinRAR, or built-in extraction
- **Mac**: Double-click the file to extract
- **Linux**: Use `tar -xzf filename.tar.gz`

### Step 3: Run QuantumCore

#### Windows:
1. Go to the extracted folder
2. Double-click `start-quantumcore.bat`
3. First launch: Electron downloads automatically (requires internet)
4. QuantumCore opens as a desktop app connected to your web account

#### Mac:
1. Go to the extracted folder
2. Double-click `start-quantumcore.sh` (or run in Terminal)
3. First launch: Electron downloads automatically (requires internet)
4. QuantumCore opens as a desktop app connected to your web account

#### Linux:
1. Go to the extracted folder
2. Run `./start-quantumcore.sh` in terminal
3. First launch: Electron downloads automatically (requires internet)
4. QuantumCore opens as a desktop app connected to your web account

## 🔧 Requirements

### System Requirements:
- **Windows**: Windows 10 or later
- **Mac**: macOS 10.15 or later
- **Linux**: Most modern distributions
- **RAM**: 4GB minimum
- **Storage**: 1GB free space (includes Electron runtime)
- **Internet**: Required for connecting to QuantumCore web service

### Prerequisites:
- **Node.js** must be installed on your computer
  - Download from: https://nodejs.org/
  - Choose the LTS (Long Term Support) version
  - Follow the installation wizard

## 🚀 How It Works

1. **Download & Extract**: Get the portable version for your OS
2. **Run the Script**: Installs Electron and launches QuantumCore desktop wrapper
3. **Desktop App**: Opens as native app window connecting to your web account
4. **Auto-Login**: Automatically connects to your existing QuantumCore account
5. **Full Access**: Same features as web version with desktop convenience

## ✅ Benefits of Desktop Version

- **Offline Capability**: Core features work without internet
- **Faster Performance**: Direct access without web server delays
- **Professional Feel**: Runs like any other desktop application
- **Easy Sharing**: Pass files to colleagues easily
- **No Browser Dependencies**: Works even if browser issues occur

## 🔒 Security & Data

- **Same Database**: Connects to the same database as web version
- **Secure Login**: Uses the same authentication system
- **Data Sync**: All changes sync with web users
- **Local Files**: Documents stored locally for faster access

## 🆘 Troubleshooting

### "Node.js not found" Error:
- Install Node.js from https://nodejs.org/
- Restart your computer after installation
- Try running the start script again

### Electron Download Fails:
- Ensure you have internet connection
- Check if corporate firewall blocks npm downloads
- Try running from a different network

### Application Doesn't Start:
- Check that Node.js is properly installed
- Ensure internet connection for Electron download
- Try deleting node_modules folder and running script again

### Cannot Connect to QuantumCore:
- Ensure you have internet connection
- Check if firewall blocks web access
- Contact your system administrator if behind corporate firewall

## 📞 Support

If you need help:
1. Check this troubleshooting guide first
2. Contact your system administrator
3. Refer to the technical documentation

## 🔄 Updates

To update QuantumCore:
1. Download the latest version
2. Extract to a new folder
3. Your data remains safe in the cloud database
4. No need to uninstall the old version