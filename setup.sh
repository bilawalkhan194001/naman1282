#!/bin/bash

# Kill any existing Gunicorn processes
if [ -f gunicorn.pid ]; then
    echo "Stopping existing Gunicorn process..."
    kill $(cat gunicorn.pid) 2>/dev/null || true
    rm gunicorn.pid 2>/dev/null || true
fi
pkill gunicorn 2>/dev/null || true

# Update system and install basic requirements
echo "Updating system and installing basic requirements..."
sudo apt update -y
sudo apt upgrade -y
sudo apt install -y git curl

# Install required system dependencies
echo "Installing system dependencies..."
sudo apt install -y \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    dbus-x11 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxi6 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libpangocairo-1.0-0 \
    alsa-utils \
    xfonts-base \
    libxkbcommon0 \
    libdrm2 \
    libgbm1 \
    gtk3

# Install Node.js 18.x if not already installed
if ! command -v node &> /dev/null || [[ $(node -v) != v18* ]]; then
    echo "Installing Node.js 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
    sudo apt install -y nodejs
fi

# Install Python 3 and pip if not already installed
if ! command -v python3 &> /dev/null; then
    echo "Installing Python3 and pip..."
    sudo apt install -y python3 python3-pip
fi

# Install `python3-venv` if not installed
if ! dpkg -s python3-venv &> /dev/null; then
    echo "Installing python3-venv..."
    sudo apt install -y python3-venv
fi

# Create and activate virtual environment
if [ ! -d venv ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
npm install
pip install --upgrade pip
pip install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py

# Get public IP
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "localhost")
echo "======================================"
echo "Server will be accessible at:"
echo "http://$PUBLIC_IP:8080"
echo "======================================"

# Wait a moment to ensure the port is free
sleep 2

# Start the Flask application with Gunicorn
echo "Starting Flask application with Gunicorn..."
./venv/bin/gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid
