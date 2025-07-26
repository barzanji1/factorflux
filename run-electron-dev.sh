#!/bin/bash

echo "Starting QuantumCore in Electron Development Mode..."

# Function to cleanup background processes
cleanup() {
    echo "Shutting down..."
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null
    fi
    exit 0
}

# Set up cleanup on script exit
trap cleanup EXIT INT TERM

# Start the server in the background
echo "Starting server..."
npm run dev &
SERVER_PID=$!

# Wait for server to be ready
echo "Waiting for server to start..."
npx wait-on http://localhost:5000

# Start Electron
echo "Starting Electron..."
NODE_ENV=development npx electron electron/main.js

# Keep script running
wait