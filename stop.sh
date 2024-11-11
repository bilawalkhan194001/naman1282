#!/bin/bash

# Function to log messages
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Stop Gunicorn
if [ -f gunicorn.pid ]; then
    log_message "Stopping gunicorn process..."
    kill $(cat gunicorn.pid)
    rm gunicorn.pid
else
    log_message "No gunicorn.pid found, trying pkill..."
    pkill gunicorn
fi

# Stop Node.js processes
log_message "Stopping Node.js processes..."
pkill -f "node index.js"

# Kill any remaining Chromium processes
log_message "Cleaning up Chromium processes..."
pkill -f chromium
pkill -f chrome

# Clean up temporary files
log_message "Cleaning up temporary files..."
rm -f qr_code.png
rm -rf .wwebjs_auth/session-*/Default/Cache/*
rm -rf .wwebjs_auth/session-*/Default/Code\ Cache/*

log_message "Application stopped and cleaned up"