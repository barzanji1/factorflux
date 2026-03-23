#!/bin/bash

# Get the current Replit URL
CURRENT_URL="https://$REPLIT_DEV_DOMAIN"
FALLBACK_URL="https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"

# Use current URL if available, otherwise use fallback
if [ -z "$REPLIT_DEV_DOMAIN" ]; then
    URL="$FALLBACK_URL"
else
    URL="$CURRENT_URL"
fi

echo "Updating desktop launchers with URL: $URL"

# Update Windows launcher
cat > electron-dist/win-portable/start-factorflux.bat << 'EOF'
@echo off
echo Starting FactorFlux Desktop...
echo This will open FactorFlux in your default web browser...
echo.

REM Try to open in default browser
start "" "$URL" 2>nul
if %errorlevel% neq 0 (
    echo If browser didn't open, manually go to:
    echo $URL
)

echo FactorFlux is now running in your browser!
echo You can close this window.
echo.
echo To create a proper desktop shortcut:
echo 1. Right-click on your desktop
echo 2. Choose "Create Shortcut"
echo 3. Enter the URL above as the location
echo 4. Name it "FactorFlux"
echo.
pause
EOF

# Replace $URL with actual URL in Windows batch file
sed -i "s|\$URL|$URL|g" electron-dist/win-portable/start-factorflux.bat

# Update Mac launcher
cat > electron-dist/mac-portable/start-factorflux.sh << 'EOF'
#!/bin/bash
echo "Starting FactorFlux Desktop..."
echo "This will open FactorFlux in your default web browser..."
echo

# Try to open in default browser
if command -v open &> /dev/null; then
    open "$URL"
elif command -v xdg-open &> /dev/null; then
    xdg-open "$URL"
elif command -v start &> /dev/null; then
    start "$URL"
else
    echo "Please manually open: $URL"
fi

echo "FactorFlux is now running in your browser!"
echo "You can close this terminal window."
echo
echo "To create a desktop app:"
echo "1. Open Safari/Chrome and go to the FactorFlux URL"
echo "2. Click Share > Add to Dock (Safari) or Add to Desktop (Chrome)"
echo "3. Name it 'FactorFlux'"
echo

read -p "Press Enter to exit..."
EOF

# Replace $URL with actual URL in Mac script
sed -i "s|\$URL|$URL|g" electron-dist/mac-portable/start-factorflux.sh

# Update Linux launcher
cat > electron-dist/linux-portable/start-factorflux.sh << 'EOF'
#!/bin/bash
echo "Starting FactorFlux Desktop..."
echo "This will open FactorFlux in your default web browser..."
echo

# Try to open in default browser
if command -v xdg-open &> /dev/null; then
    xdg-open "$URL"
elif command -v firefox &> /dev/null; then
    firefox "$URL"
elif command -v google-chrome &> /dev/null; then
    google-chrome "$URL"
else
    echo "Please manually open: $URL"
fi

echo "FactorFlux is now running in your browser!"
echo "You can close this terminal window."
echo
echo "To create a desktop shortcut:"
echo "1. Right-click on desktop > Create Launcher"
echo "2. Name: FactorFlux"
echo "3. Command: xdg-open $URL"
echo

read -p "Press Enter to exit..."
EOF

# Replace $URL with actual URL in Linux script
sed -i "s|\$URL|$URL|g" electron-dist/linux-portable/start-factorflux.sh

# Make scripts executable
chmod +x electron-dist/mac-portable/start-factorflux.sh
chmod +x electron-dist/linux-portable/start-factorflux.sh

echo "Desktop launchers updated successfully!"
echo "Using URL: $URL"