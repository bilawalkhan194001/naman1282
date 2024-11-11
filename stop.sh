#!/bin/bash

# Stop Gunicorn (Flask app)
if [ -f gunicorn.pid ]; then
    kill $(cat gunicorn.pid)
    rm gunicorn.pid
fi

# Stop Node.js app
if [ -f node.pid ]; then
    kill $(cat node.pid)
    rm node.pid
fi

echo "Application stopped"