#!/bin/bash

# Kill any existing gunicorn processes
if [ -f gunicorn.pid ]; then
    echo "Stopping existing gunicorn process..."
    kill $(cat gunicorn.pid) 2>/dev/null || true
    rm gunicorn.pid 2>/dev/null || true
fi
pkill gunicorn 2>/dev/null || true

# Install Node.js 18.x if not already installed
if ! command -v node &> /dev/null || [[ $(node -v) != v18* ]]; then
    echo "Installing Node.js 18.x..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    sudo yum install -y nodejs
fi

# Install Chromium dependencies for Amazon Linux
echo "Installing Chromium dependencies..."
sudo yum update -y
sudo yum install -y \
    alsa-lib.x86_64 \
    atk.x86_64 \
    cups-libs.x86_64 \
    gtk3.x86_64 \
    ipa-gothic-fonts \
    libXcomposite.x86_64 \
    libXcursor.x86_64 \
    libXdamage.x86_64 \
    libXext.x86_64 \
    libXi.x86_64 \
    libXrandr.x86_64 \
    libXScrnSaver.x86_64 \
    libXtst.x86_64 \
    pango.x86_64 \
    xorg-x11-fonts-100dpi \
    xorg-x11-fonts-75dpi \
    xorg-x11-fonts-cyrillic \
    xorg-x11-fonts-misc \
    xorg-x11-fonts-Type1 \
    xorg-x11-utils \
    nss.x86_64 \
    chromium \
    chromium-headless-chromium

# Install Python and pip if not already installed
if ! command -v python3 &> /dev/null; then
    echo "Installing Python3 and pip..."
    sudo yum install -y python3 python3-pip
fi

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
echo "Installing Node.js dependencies..."
npm install
echo "Installing Python dependencies..."
pip3 install -r requirements.txt

# Set environment variables
export FLASK_ENV=production
export FLASK_APP=dashboard.py
# Set Puppeteer environment variables
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Get public IP
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
echo "======================================"
echo "Server will be accessible at:"
echo "http://$PUBLIC_IP:8080"
echo "======================================"

# Wait a moment to ensure the port is free
sleep 2

# Start the Flask application with Gunicorn
./venv/bin/gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid