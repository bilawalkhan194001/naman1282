#!/bin/bash
if [ -f gunicorn.pid ]; then
    kill $(cat gunicorn.pid)
    rm gunicorn.pid
    echo "Server stopped"
else
    echo "Server not running"
fi