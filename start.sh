#!/bin/bash

# Update system and install dependencies
echo "Updating system and installing required packages..."
sudo apt-get update -y
sudo apt-get install -y git python3 python3-pip curl

# Install Node.js 18.x if not already installed
if ! command -v node &> /dev/null || [[ $(node -v) != v18* ]]; then
    echo "Installing Node.js 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install project dependencies
echo "Installing project dependencies..."
npm install
pip3 install -r requirements.txt

# Load environment variables from .env file
if [ -f .env ]; then
    echo "Loading environment variables from .env file..."
    export $(grep -v '^#' .env | xargs)
fi

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Retrieve the port assigned by Railway
PORT=${PORT:-8080}

# Inform the user about the application URL
echo "======================================"
echo "Server will be accessible at:"
echo "http://localhost:$PORT"
echo "======================================"

# Wait briefly to ensure the port is free
sleep 2

# Start the Flask application with Gunicorn
exec gunicorn --bind 0.0.0.0:$PORT dashboard:app
