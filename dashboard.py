# from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file
# from functools import wraps
# import json
# import os
# import logging
# import subprocess
# import signal
# import shutil
# import time

# app = Flask(__name__)
# app.secret_key = 'your_secret_key_here'  # Replace with a strong secret key
# logging.basicConfig(level=logging.DEBUG)

# # Add these global variables at the top level
# bot_process = None
# bot_connected = False


# def login_required(f):
#     @wraps(f)
#     def decorated_function(*args, **kwargs):
#         if 'logged_in' not in session:
#             return redirect(url_for('login', next=request.url))
#         return f(*args, **kwargs)
#     return decorated_function


# @app.route('/login', methods=['GET', 'POST'])
# def login():
#     if request.method == 'POST':
#         username = request.form['username']
#         password = request.form['password']
#         if username == 'Travel' and password == 'TRAVEL-AGENCY':
#             session['logged_in'] = True
#             return redirect(url_for('index'))
#         else:
#             return render_template('login.html', error='Invalid credentials')
#     return render_template('login.html')


# @app.route('/logout')
# def logout():
#     session.pop('logged_in', None)
#     return redirect(url_for('login'))


# @app.route('/')
# @login_required
# def index():
#     return render_template('index.html')


# @app.route('/start_bot')
# @login_required
# def start_bot():
#     global bot_process, bot_connected
#     if bot_process is None or bot_process.poll() is not None:
#         # Ensure any existing process is properly terminated
#         if bot_process is not None:
#             try:
#                 os.kill(bot_process.pid, signal.SIGINT)
#                 bot_process.wait(timeout=10)
#             except (ProcessLookupError, subprocess.TimeoutExpired):
#                 pass
        
#         # Start the new process
#         try:
#             bot_process = subprocess.Popen(['node', 'index.js'], 
#                                          stdout=subprocess.PIPE,
#                                          stderr=subprocess.PIPE,
#                                          universal_newlines=True)
#             bot_connected = False
#             return jsonify({"message": "Bot started successfully", "connected": False})
#         except Exception as e:
#             return jsonify({"message": f"Failed to start bot: {str(e)}", "connected": False})
#     else:
#         return jsonify({"message": "Bot is already running", "connected": bot_connected})


# @app.route('/stop_bot')
# @login_required
# def stop_bot():
#     global bot_process, bot_connected
#     if bot_process is not None and bot_process.poll() is None:
#         # Send SIGINT instead of SIGTERM to allow for graceful shutdown
#         os.kill(bot_process.pid, signal.SIGINT)
        
#         # Give the process some time to cleanup
#         try:
#             bot_process.wait(timeout=10)  # Wait up to 10 seconds for the process to end
#         except subprocess.TimeoutExpired:
#             # If it doesn't exit within 10 seconds, force kill it
#             os.kill(bot_process.pid, signal.SIGKILL)
#             bot_process.wait()
            
#         bot_process = None
#         bot_connected = False
#         return jsonify({"message": "Bot stopped successfully", "connected": False})
#     else:
#         return jsonify({"message": "Bot is not running", "connected": False})


# @app.route('/get_qr_code')
# @login_required
# def get_qr_code():
#     qr_code_file = 'qr_code.png'
#     if os.path.exists(qr_code_file):
#         return send_file(qr_code_file, mimetype='image/png')
#     return jsonify({"message": "QR code not available"})


# @app.route('/bot_status')
# @login_required
# def bot_status():
#     global bot_connected
#     return jsonify({"connected": bot_connected})


# @app.route('/is_bot_ready')
# @login_required
# def is_bot_ready():
#     global bot_connected
#     return jsonify({"ready": bot_connected})


# @app.route('/qr_code_exists')
# @login_required
# def qr_code_exists():
#     return jsonify({"exists": os.path.exists('qr_code.png')})


# @app.route('/set_bot_connected', methods=['POST'])
# def set_bot_connected():
#     global bot_connected
#     bot_connected = True
#     if os.path.exists('qr_code.png'):
#         os.remove('qr_code.png')
#     return jsonify({"message": "Bot connection status updated", "ready": True})


# @app.route('/reset_bot')
# @login_required
# def reset_bot():
#     global bot_process, bot_connected

#     if bot_process is not None and bot_process.poll() is None:
#         os.kill(bot_process.pid, signal.SIGTERM)
#         bot_process.wait()
#         bot_process = None

#     cache_dir = '.wwebjs_auth'
#     if os.path.exists(cache_dir):
#         max_attempts = 5
#         for attempt in range(max_attempts):
#             try:
#                 shutil.rmtree(cache_dir)
#                 break
#             except PermissionError:
#                 if attempt < max_attempts - 1:
#                     time.sleep(1)  # Wait for 1 second before retrying
#                 else:
#                     return jsonify({"message": "Failed to remove cache. Please try again.", "connected": False})

#     if os.path.exists('qr_code.png'):
#         try:
#             os.remove('qr_code.png')
#         except PermissionError:
#             pass  # Ignore if we can't delete the QR code file

#     bot_process = subprocess.Popen(['node', 'index.js'])
#     bot_connected = False

#     return jsonify({"message": "Bot reset successfully. Please scan the new QR code.", "connected": False})


# if __name__ == '__main__':
#     app.logger.info("Starting the Flask application...")
#     app.run(debug=True, host='0.0.0.0', port=8080)
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file
from functools import wraps
import json
import os
import logging
import subprocess
import signal
import shutil
import time

app = Flask(__name__)
# Replace with a strong secret key
app.secret_key = 'hgfdsdfghjhgfdrty5434567uyt56uhgfrt6y78765432ertyj'
logging.basicConfig(level=logging.DEBUG)

# Add these global variables at the top level
bot_process = None
bot_connected = False


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
        if username == 'Travel' and password == 'TRAVEL-AGENCY':
            session['logged_in'] = True
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
    return render_template('index.html')


@app.route('/start_bot')
@login_required
def start_bot():
    global bot_process, bot_connected
    if bot_process is None or bot_process.poll() is not None:
        bot_process = subprocess.Popen(['node', 'index.js'])
        bot_connected = False
        return jsonify({"message": "Bot started successfully", "connected": False})
    else:
        return jsonify({"message": "Bot is already running", "connected": bot_connected})


@app.route('/stop_bot')
@login_required
def stop_bot():
    global bot_process, bot_connected
    if bot_process is not None and bot_process.poll() is None:
        os.kill(bot_process.pid, signal.SIGTERM)
        bot_process.wait()
        bot_process = None
        bot_connected = False
        return jsonify({"message": "Bot stopped successfully", "connected": False})
    else:
        return jsonify({"message": "Bot is not running", "connected": False})


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
    return jsonify({"exists": os.path.exists('qr_code.png')})


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

    if bot_process is not None and bot_process.poll() is None:
        os.kill(bot_process.pid, signal.SIGTERM)
        bot_process.wait()
        bot_process = None

    cache_dir = '.wwebjs_auth'
    if os.path.exists(cache_dir):
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                shutil.rmtree(cache_dir)
                break
            except PermissionError:
                if attempt < max_attempts - 1:
                    time.sleep(1)  # Wait for 1 second before retrying
                else:
                    return jsonify({"message": "Failed to remove cache. Please try again.", "connected": False})

    if os.path.exists('qr_code.png'):
        try:
            os.remove('qr_code.png')
        except PermissionError:
            pass  # Ignore if we can't delete the QR code file

    bot_process = subprocess.Popen(['node', 'index.js'])
    bot_connected = False

    return jsonify({"message": "Bot reset successfully. Please scan the new QR code.", "connected": False})


if __name__ == '__main__':
    app.logger.info("Starting the Flask application...")
    app.run(debug=True, host='0.0.0.0', port=8080)
