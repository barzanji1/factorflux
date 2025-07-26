@echo off
echo Starting QuantumCore Desktop...
echo This will open QuantumCore in your default web browser...
echo.

REM Try to open in default browser
start "" "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev" 2>nul
if %errorlevel% neq 0 (
    echo If browser didn't open, manually go to:
    echo https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev
)

echo QuantumCore is now running in your browser!
echo You can close this window.
echo.
echo To create a proper desktop shortcut:
echo 1. Right-click on your desktop
echo 2. Choose "Create Shortcut"
echo 3. Enter the URL above as the location
echo 4. Name it "QuantumCore"
echo.
pause
