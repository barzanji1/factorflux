#!/bin/bash
echo "Starting QuantumCore Desktop..."
echo "This will open QuantumCore in your default web browser..."
echo

# Try to open in default browser
if command -v open &> /dev/null; then
    open "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
elif command -v xdg-open &> /dev/null; then
    xdg-open "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
elif command -v start &> /dev/null; then
    start "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
else
    echo "Please manually open: https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev"
fi

echo "QuantumCore is now running in your browser!"
echo "You can close this terminal window."
echo
echo "To create a desktop app:"
echo "1. Open Safari/Chrome and go to the QuantumCore URL"
echo "2. Click Share > Add to Dock (Safari) or Add to Desktop (Chrome)"
echo "3. Name it 'QuantumCore'"
echo

read -p "Press Enter to exit..."
