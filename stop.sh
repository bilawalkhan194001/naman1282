#!/bin/bash

# Kill any existing Chrome/Chromium processes
pkill -f chromium
pkill -f chrome

if [ -f gunicorn.pid ]; then
    echo "Stopping gunicorn process..."
    kill $(cat gunicorn.pid)
    rm gunicorn.pid
else
    echo "No gunicorn.pid found, trying pkill..."
    pkill gunicorn
fi

# Stop Node.js app
if [ -f node.pid ]; then
    kill $(cat node.pid)
    rm node.pid
fi

# Clean up any remaining .auth files
rm -rf .wwebjs_auth

echo "Application stopped"