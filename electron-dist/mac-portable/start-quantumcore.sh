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

    URL="https://factorflux.co"

    # Try to open in default browser
    if command -v open &> /dev/null; then
        open "$URL"
        echo "✅ QuantumCore opened in your default browser!"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$URL"
        echo "✅ QuantumCore opened in your default browser!"
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
    echo "   • Safari: Share > Add to Dock"
    echo "   • Chrome: More Tools > Create Shortcut > Open as Window"
    echo

    read -p "Press Enter to exit..."
fi
