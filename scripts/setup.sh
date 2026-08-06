#!/usr/bin/env bash
echo "Setting up JB³ GameHub Development Environment..."

if ! command -v node &> /dev/null
then
    echo "Node.js could not be found. Please install Node.js >= 20.x"
    exit 1
fi

echo "Installing npm dependencies..."
npm install

echo "Environment ready! Run 'npm run dev' to start JB³ GameHub."
