#!/bin/bash

echo
echo "========================================"
echo "   QuantumCore Desktop Launcher"
echo "========================================"
echo

# Check if Node.js is available
if command -v node &> /dev/null; then
    echo "Using Node.js launcher..."
    node simple-browser-launcher.js
else
    echo "Node.js not found, using basic launcher..."
    echo
    echo "Starting QuantumCore Desktop..."
    echo "This will open QuantumCore in your default web browser..."
    echo

    URL="https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"

    # Try to open in default browser
    if command -v xdg-open &> /dev/null; then
        xdg-open "$URL"
        echo "✅ QuantumCore opened in your default browser!"
    elif command -v firefox &> /dev/null; then
        firefox "$URL" &
        echo "✅ QuantumCore opened in Firefox!"
    elif command -v google-chrome &> /dev/null; then
        google-chrome "$URL" &
        echo "✅ QuantumCore opened in Chrome!"
    else
        echo "❌ Could not automatically open browser."
        echo "📋 Please manually open this URL:"
        echo "🔗 $URL"
    fi

    echo
    echo "💡 You can bookmark this URL for easy access:"
    echo "🔗 $URL"
    echo
    echo "📱 To create a desktop app experience:"
    echo "   • Chrome: More Tools > Create Shortcut > Open as Window"
    echo "   • Firefox: Right-click > Create Desktop Shortcut"
    echo
    echo "🖥️  To create a desktop launcher:"
    echo "   1. Right-click on desktop > Create Launcher"
    echo "   2. Name: QuantumCore"
    echo "   3. Command: xdg-open $URL"
    echo

    read -p "Press Enter to exit..."
fi
