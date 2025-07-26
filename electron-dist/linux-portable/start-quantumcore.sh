#!/bin/bash
echo "Starting QuantumCore Desktop..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org"
    echo "Then run this script again"
    exit 1
fi

echo "Installing dependencies..."
npm install --silent electron@latest

echo "Launching QuantumCore..."
npx electron .
