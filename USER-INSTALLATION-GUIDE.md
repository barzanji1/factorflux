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
3. First launch: Electron will download automatically (one-time setup)
4. QuantumCore will open as a desktop application window

#### Mac:
1. Go to the extracted folder
2. Double-click `start-quantumcore.sh` (or run in Terminal)
3. First launch: Electron will download automatically (one-time setup)
4. QuantumCore will open as a desktop application window

#### Linux:
1. Go to the extracted folder
2. Run `./start-quantumcore.sh` in terminal
3. First launch: Electron will download automatically (one-time setup)
4. QuantumCore will open as a desktop application window

## 🔧 Requirements

### System Requirements:
- **Windows**: Windows 10 or later
- **Mac**: macOS 10.15 or later
- **Linux**: Most modern distributions
- **RAM**: 4GB minimum
- **Storage**: 1GB free space (includes Electron runtime)
- **Internet**: Required for database access

### Prerequisites:
- **Node.js** must be installed on your computer
  - Download from: https://nodejs.org/
  - Choose the LTS (Long Term Support) version
  - Follow the installation wizard

## 🚀 How It Works

1. **Download & Extract**: Get the portable version for your OS
2. **Run the Script**: The startup script installs Electron and launches QuantumCore
3. **Desktop App**: QuantumCore opens as a native desktop application
4. **Login**: Use your Replit account to access the system
5. **Full Access**: All features work just like the web version

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

### Port Already in Use:
- Close any other QuantumCore instances
- Restart your computer
- Run the start script again

### Application Doesn't Start:
- Check that Node.js is properly installed
- Ensure you have internet connection for first-time Electron download
- Check if any firewall is blocking the application

### Database Connection Issues:
- Ensure you have internet connection
- Check if your firewall allows the application
- Contact your system administrator

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