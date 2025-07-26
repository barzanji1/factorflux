@echo off
echo.
echo ========================================
echo    QuantumCore Desktop Launcher
echo ========================================
echo.

REM Check if Node.js is available
node --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Using Node.js launcher...
    node simple-browser-launcher.js
) else (
    echo Node.js not found, using basic launcher...
    echo.
    echo Starting QuantumCore Desktop...
    echo This will open QuantumCore in your default web browser...
    echo.
    
    REM Try to open in default browser
    start "" "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev" 2>nul
    if %errorlevel% neq 0 (
        echo If browser didn't open, manually go to:
        echo https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev
    )
    
    echo.
    echo QuantumCore is now running in your browser!
    echo You can bookmark this URL for easy access.
    echo.
    echo To create a desktop app experience:
    echo 1. In Chrome: More Tools ^> Create Shortcut ^> Open as Window
    echo 2. In Edge: Apps ^> Install this site as an app
    echo.
    pause
)
