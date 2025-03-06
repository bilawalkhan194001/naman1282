from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file
from flask_socketio import SocketIO, emit
from functools import wraps
import json
import os
import logging
import subprocess
import signal
import shutil
import time
import threading
from datetime import datetime, timedelta
import platform
import sys
import psutil
from dotenv import load_dotenv

# Monkey patch for eventlet compatibility with Python 3.12
import eventlet
eventlet.monkey_patch()

# Load environment variables
load_dotenv()

app = Flask(__name__)
# Get secret key from environment variable
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'default_secret_key')
# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*")
logging.basicConfig(level=logging.DEBUG)

# Add these global variables at the top level
bot_process = None
bot_connected = False
# Flag to control background threads
should_run_background_tasks = True

# Get dashboard credentials from environment variables
DASHBOARD_USERNAME = os.environ.get('DASHBOARD_USERNAME', 'ai')
DASHBOARD_PASSWORD = os.environ.get('DASHBOARD_PASSWORD', 'WH102938jp..@')


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if username == DASHBOARD_USERNAME and password == DASHBOARD_PASSWORD:
            session['logged_in'] = True
            session['username'] = username
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='Invalid credentials')
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))


@app.route('/')
@login_required
def index():
    # Get username from session or use default
    username = session.get('username', 'admin')
    user = {'username': username}
    return render_template('index.html', user=user)


@app.route('/get_qr_code')
@login_required
def get_qr_code():
    qr_code_file = 'qr_code.png'
    if os.path.exists(qr_code_file):
        return send_file(qr_code_file, mimetype='image/png')
    return jsonify({"message": "QR code not available"})


@app.route('/bot_status')
@login_required
def bot_status():
    global bot_connected
    return jsonify({"connected": bot_connected})


@app.route('/is_bot_ready')
@login_required
def is_bot_ready():
    global bot_connected
    return jsonify({"ready": bot_connected})


@app.route('/qr_code_exists')
@login_required
def qr_code_exists():
    global bot_process, bot_connected

    # Check if bot is running but not connected (connecting state)
    bot_running = bot_process is not None and bot_process.poll() is None
    is_connecting = bot_running and not bot_connected

    # Only check for QR code if we're in a connecting state
    qr_exists = os.path.exists('qr_code.png') if is_connecting else False

    return jsonify({
        "exists": qr_exists,
        "is_connecting": is_connecting,
        "bot_running": bot_running
    })


@app.route('/set_bot_connected', methods=['POST'])
def set_bot_connected():
    global bot_connected
    bot_connected = True
    if os.path.exists('qr_code.png'):
        os.remove('qr_code.png')
    return jsonify({"message": "Bot connection status updated", "ready": True})


@app.route('/reset_bot')
@login_required
def reset_bot():
    global bot_process, bot_connected

    # Update UI immediately
    socketio.emit('bot_status', {'connected': False, 'status': 'resetting'})

    # Stop the bot if it's running
    if bot_process is not None and bot_process.poll() is None:
        try:
            os.kill(bot_process.pid, signal.SIGTERM)
            bot_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            # Force kill if it doesn't terminate gracefully
            os.kill(bot_process.pid, signal.SIGKILL)
        except Exception as e:
            app.logger.error(f"Error stopping bot during reset: {str(e)}")

        bot_process = None

    # Clear the auth directory
    cache_dir = '.wwebjs_auth'
    if os.path.exists(cache_dir):
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                shutil.rmtree(cache_dir)
                break
            except PermissionError:
                if attempt < max_attempts - 1:
                    time.sleep(1)
                else:
                    return jsonify({
                        "message": "Failed to remove cache. Please try again.",
                        "connected": False,
                        "error": True,
                        "status": "error"
                    })

    # Remove old QR code if it exists
    if os.path.exists('qr_code.png'):
        try:
            os.remove('qr_code.png')
        except PermissionError:
            pass

    # Start the bot
    try:
        bot_process = subprocess.Popen(['node', 'index.js'])

        # Wait a moment to check if the process started successfully
        time.sleep(1)
        if bot_process.poll() is not None:
            # Process terminated immediately
            return jsonify({
                "message": "Failed to restart bot. Check server logs for details.",
                "connected": False,
                "error": True,
                "status": "error"
            })

        bot_connected = False

        # Emit status update via WebSocket
        socketio.emit(
            'bot_status', {'connected': False, 'status': 'connecting'})

        return jsonify({
            "message": "Bot reset successfully. Please wait for the QR code to appear.",
            "connected": False,
            "status": "connecting"
        })
    except Exception as e:
        app.logger.error(f"Error restarting bot after reset: {str(e)}")
        return jsonify({
            "message": f"Error restarting bot: {str(e)}",
            "connected": False,
            "error": True,
            "status": "error"
        })


@app.route('/set_bot_disconnected', methods=['POST'])
def set_bot_disconnected():
    global bot_connected
    bot_connected = False
    return jsonify({'message': 'Bot disconnected status updated'})


@app.route('/start_bot')
@login_required
def start_bot():
    global bot_process, bot_connected

    # If bot is already running, return success
    if bot_process is not None and bot_process.poll() is None:
        return jsonify({
            "message": "Bot is already running",
            "connected": bot_connected,
            "status": "connecting" if not bot_connected else "connected"
        })

    # Check if auth directory exists and has session data
    auth_dir = '.wwebjs_auth'
    session_exists = os.path.exists(auth_dir) and os.path.exists(
        os.path.join(auth_dir, 'session'))

    # Start the bot
    try:
        bot_process = subprocess.Popen(['node', 'index.js'])

        # Wait a moment to check if the process started successfully
        time.sleep(1)
        if bot_process.poll() is not None:
            # Process terminated immediately
            return jsonify({
                "message": "Failed to start bot. Check server logs for details.",
                "connected": False,
                "error": True,
                "status": "error"
            })

        # Emit status update via WebSocket
        socketio.emit(
            'bot_status', {'connected': False, 'status': 'connecting'})

        # If we have a session, we might reconnect automatically
        connection_message = "Bot started successfully. Attempting to reconnect to existing session..." if session_exists else "Bot started successfully. Waiting for connection..."

        return jsonify({
            "message": connection_message,
            "connected": False,
            "status": "connecting",
            "session_exists": session_exists
        })
    except Exception as e:
        app.logger.error(f"Error starting bot: {str(e)}")
        return jsonify({
            "message": f"Error starting bot: {str(e)}",
            "connected": False,
            "error": True,
            "status": "error"
        })


@app.route('/stop_bot')
@login_required
def stop_bot():
    global bot_process, bot_connected

    # If bot is running, stop it
    if bot_process is not None and bot_process.poll() is None:
        try:
            os.kill(bot_process.pid, signal.SIGTERM)
            # Wait up to 5 seconds for process to terminate
            bot_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            # Force kill if it doesn't terminate gracefully
            os.kill(bot_process.pid, signal.SIGKILL)
        except Exception as e:
            app.logger.error(f"Error stopping bot: {str(e)}")
            return jsonify({
                "message": f"Error stopping bot: {str(e)}",
                "connected": bot_connected,
                "error": True
            })

        bot_process = None

    # Update connection status
    bot_connected = False

    # Emit status update via WebSocket
    socketio.emit('bot_status', {'connected': False, 'status': 'stopped'})

    return jsonify({
        "message": "Bot stopped successfully",
        "connected": False,
        "status": "stopped"
    })


@app.route('/system_info')
@login_required
def system_info():
    """Endpoint to provide system information for the dashboard."""
    return jsonify(get_system_info())


@app.route('/login.js')
def serve_login_js():
    """Serve the login.js file."""
    return send_file('login.js', mimetype='application/javascript')


# WebSocket event handlers
@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection."""
    global bot_connected, bot_process
    client_id = request.sid
    app.logger.info(f"Client connected: {client_id}")

    # Check if bot process is running
    bot_running = bot_process is not None and bot_process.poll() is None

    # Determine status
    status = 'connected' if bot_connected else 'disconnected'
    if bot_running and not bot_connected:
        status = 'connecting'

    # Send initial status
    emit('bot_status', {
        'connected': bot_connected,
        'status': status,
        'bot_running': bot_running
    })

    # Only send QR code info if the bot is in a connecting state
    # or if it's already connected
    if status == 'connecting' or bot_connected:
        qr_exists = os.path.exists('qr_code.png')
        emit('qr_code', {
            'exists': qr_exists,
            'qr_code_url': f'/get_qr_code?t={int(time.time())}' if qr_exists else None,
            'status': 'waiting_for_scan' if qr_exists else 'no_qr'
        })

    # Send system info
    emit('system_info', get_system_info())


@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info(f"Client disconnected: {request.sid}")

# Background task for sending updates


def background_update_task():
    """Background task to periodically update clients with latest information."""
    global should_run_background_tasks, bot_connected, bot_process

    last_qr_status = False
    last_bot_status = bot_connected
    last_bot_running = bot_process is not None and bot_process.poll() is None

    while should_run_background_tasks:
        try:
            # Check if bot process is running
            bot_running = bot_process is not None and bot_process.poll() is None

            # Determine status
            status = 'connected' if bot_connected else 'disconnected'
            if bot_running and not bot_connected:
                status = 'connecting'

            # Check if QR code exists
            qr_exists = os.path.exists('qr_code.png')

            # Only emit QR code updates if the bot is in a connecting state
            # or if it's already connected
            if (status == 'connecting' or bot_connected) and qr_exists != last_qr_status:
                socketio.emit('qr_code', {
                    'exists': qr_exists,
                    'qr_code_url': f'/get_qr_code?t={int(time.time())}' if qr_exists else None,
                    'status': 'waiting_for_scan' if qr_exists else 'no_qr'
                })
                last_qr_status = qr_exists

            # Check bot status and emit if changed
            if bot_connected != last_bot_status or bot_running != last_bot_running:
                socketio.emit('bot_status', {
                    'connected': bot_connected,
                    'status': status,
                    'bot_running': bot_running
                })
                last_bot_status = bot_connected
                last_bot_running = bot_running

            # Periodically send system info (every 30 seconds)
            if int(time.time()) % 30 == 0:
                socketio.emit('system_info', get_system_info())

            time.sleep(1)
        except Exception as e:
            app.logger.error(f"Error in background task: {str(e)}")
            time.sleep(5)  # Wait longer if there's an error


def get_system_info():
    """Helper function to get system information"""
    # Get server time
    server_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Get system uptime
    try:
        uptime_seconds = time.time() - psutil.boot_time()
        uptime = str(timedelta(seconds=int(uptime_seconds)))
    except:
        uptime = "Unknown"

    # Get Node.js version if available
    try:
        node_version = subprocess.check_output(
            ['node', '--version']).decode().strip()
    except:
        node_version = "Not installed"

    # Get Python version
    python_version = f"{platform.python_version()} ({platform.python_implementation()})"

    return {
        "server_time": server_time,
        "uptime": uptime,
        "node_version": node_version,
        "python_version": python_version
    }


if __name__ == '__main__':
    app.logger.info("Starting the Flask application...")

    # Start background task in a separate thread
    background_thread = threading.Thread(target=background_update_task)
    background_thread.daemon = True
    background_thread.start()

    try:
        socketio.run(app, debug=True, host='0.0.0.0',
                     port=8080, allow_unsafe_werkzeug=True)
    finally:
        # Signal background thread to stop
        should_run_background_tasks = False
        if background_thread.is_alive():
            background_thread.join(timeout=5)
