#!/bin/bash

# Install Node.js 18.x if not already installed
if ! command -v node &> /dev/null || [[ $(node -v) != v18* ]]; then
    echo "Installing Node.js 18.x..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    sudo yum install -y nodejs
fi

# Install Python and pip if not already installed
if ! command -v python3 &> /dev/null; then
    echo "Installing Python3 and pip..."
    sudo yum update -y
    sudo yum install -y python3 python3-pip
fi

# Install dependencies
npm install
pip3 install -r requirements.txt

# Set environment variables
export FLASK_DEBUG=0
export FLASK_APP=dashboard.py

# Start the Flask application with Gunicorn
gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid --daemon