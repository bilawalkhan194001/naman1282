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

# Remove existing Chrome installations
echo "Removing existing Chrome installations..."
sudo yum remove -y google-chrome-stable chromium chromium-headless-chromium
sudo rm -f /etc/yum.repos.d/google-chrome.repo

# Install Chrome dependencies for Amazon Linux 2
echo "Installing Chrome dependencies..."
sudo yum update -y
sudo yum install -y \
    cups \
    cups-libs \
    cups-client \
    alsa-lib \
    atk \
    gtk3 \
    ipa-gothic-fonts \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango \
    xorg-x11-fonts-100dpi \
    xorg-x11-fonts-75dpi \
    xorg-x11-fonts-cyrillic \
    xorg-x11-fonts-misc \
    xorg-x11-fonts-Type1 \
    xorg-x11-utils \
    nss \
    libdrm \
    mesa-libgbm \
    dbus-libs \
    libXss \
    libXinerama \
    GConf2 \
    fontconfig \
    liberation-fonts

# Add Google Chrome repository
echo "Adding Chrome repository..."
cat << EOF | sudo tee /etc/yum.repos.d/google-chrome.repo
[google-chrome]
name=google-chrome
baseurl=http://dl.google.com/linux/chrome/rpm/stable/x86_64
enabled=1
gpgcheck=1
gpgkey=https://dl.google.com/linux/linux_signing_key.pub
EOF

# Install Chrome
echo "Installing Chrome..."
sudo yum install -y google-chrome-stable

# Verify Chrome installation
echo "Verifying Chrome installation..."
google-chrome --version

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
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm install
echo "Installing Python dependencies..."
pip3 install -r requirements.txt

# Set environment variables
export FLASK_DEBUG=false
export FLASK_APP=dashboard.py
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

# Get public IP
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
echo "======================================"
echo "Server will be accessible at:"
echo "http://$PUBLIC_IP:8080"
echo "======================================"

# Create a wrapper script for Chrome
echo "Creating Chrome wrapper script..."
cat << 'EOF' | sudo tee /usr/local/bin/chrome-wrapper
#!/bin/bash
exec /usr/bin/google-chrome --no-sandbox --disable-setuid-sandbox "$@"
EOF
sudo chmod +x /usr/local/bin/chrome-wrapper

# Update the Puppeteer executable path
export PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chrome-wrapper

# Wait a moment to ensure the port is free
sleep 2

# Start the Flask application with Gunicorn
./venv/bin/gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid