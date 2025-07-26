@echo off
echo Starting QuantumCore Desktop...
echo Checking Node.js installation...
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org
    echo Then restart this script
    pause
    exit /b 1
)

echo Installing dependencies...
npm install --silent electron@latest

echo Launching QuantumCore...
npx electron .
pause
