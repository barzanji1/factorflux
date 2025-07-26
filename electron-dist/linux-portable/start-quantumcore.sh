#!/bin/bash
echo "Starting QuantumCore Desktop..."
echo "This will open QuantumCore in your default web browser..."
echo

# Try to open in default browser
if command -v xdg-open &> /dev/null; then
    xdg-open "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
elif command -v firefox &> /dev/null; then
    firefox "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
elif command -v google-chrome &> /dev/null; then
    google-chrome "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
else
    echo "Please manually open: https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
fi

echo "QuantumCore is now running in your browser!"
echo "You can close this terminal window."
echo
echo "To create a desktop shortcut:"
echo "1. Right-click on desktop > Create Launcher"
echo "2. Name: QuantumCore"
echo "3. Command: xdg-open https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
echo

read -p "Press Enter to exit..."
