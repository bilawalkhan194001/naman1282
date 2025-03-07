require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const OpenAI = require('openai');
const functions = require('./functions');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Get admin numbers from environment variable
const ADMIN_NUMBERS = process.env.ADMIN_NUMBERS ? process.env.ADMIN_NUMBERS.split(',') : ['923499490427', '97433862975', '97430171900', '97455082358'];
global.ADMIN_NUMBERS = ADMIN_NUMBERS;

const assistant = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

// Maximum number of reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;
let reconnectTimeout = null;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
        timeout: 60000, // Increase timeout to 60 seconds
    },
    restartOnAuthFail: true,
});

let isBotActive = true;
let lastBotMessage = '';
let lastHumanMessage = '';
let botNumber = '';
let lastProcessedMessageTime = 0;
const processedMessageIds = new Set();

const picsFolder = path.join(__dirname, 'pics');
if (!fs.existsSync(picsFolder)) {
    fs.mkdirSync(picsFolder);
}

let isResetMode = false;
let isInitialized = false;
let isCheckingMessages = false;
let messageCheckInterval = null;

function stopBot() {
    isBotActive = false;
    if (messageCheckInterval) {
        clearInterval(messageCheckInterval);
        messageCheckInterval = null;
    }
}

function startBot() {
    isBotActive = true;
    if (!messageCheckInterval && isInitialized) {
        messageCheckInterval = setInterval(checkForNewMessages, 5000);
    }
}

client.on('qr', (qr) => {
    qrcode.toFile('qr_code.png', qr, {
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    }, (err) => {
        if (err) {
            console.error('Error generating QR code:', err);
        }
    });
});

client.on('ready', () => {
    console.log('Client is ready!');
    isInitialized = true;

    // Get the bot's own number
    botNumber = client.info.wid.user;

    // Add bot number to admin numbers if not already included
    if (!ADMIN_NUMBERS.includes(botNumber)) {
        ADMIN_NUMBERS.push(botNumber);
    }

    // Load ignore list
    functions.loadIgnoreList();

    // Start checking for messages
    if (isBotActive && !messageCheckInterval) {
        messageCheckInterval = setInterval(checkForNewMessages, 5000);
    }

    // Reset reconnection attempts on successful connection
    reconnectAttempts = 0;

    // Update bot status on dashboard
    fetch('http://0.0.0.0:8080/set_bot_connected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    })
        .then(response => response.json())
        .catch(error => console.error('Error updating bot status:', error));
});

async function checkForNewMessages() {
    if (!isBotActive || isCheckingMessages) return;

    isCheckingMessages = true;
    try {
        // Check if client is ready
        if (!client.pupPage || !client.pupBrowser) {
            console.log("WhatsApp client not ready, attempting to reconnect...");
            await handleReconnection();
            isCheckingMessages = false;
            return;
        }

        const chat = await client.getChatById(`${botNumber}@c.us`);
        const messages = await chat.fetchMessages({ limit: 1 });

        if (messages.length > 0) {
            const latestMessage = messages[0];

            if (latestMessage.from === `${botNumber}@c.us`) {
                if (latestMessage.timestamp > lastProcessedMessageTime && !processedMessageIds.has(latestMessage.id._serialized)) {
                    lastProcessedMessageTime = latestMessage.timestamp;
                    await processMessage(latestMessage);
                }
            }
        }
        // Reset reconnect attempts on successful operation
        reconnectAttempts = 0;
    } catch (error) {
        console.error('Error checking for new messages:', error);

        // Check if it's a session closed error
        if (error.message && error.message.includes('Session closed')) {
            await handleReconnection();
        }
    } finally {
        isCheckingMessages = false;
    }
}

async function handleReconnection() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Please restart the application manually.`);
        stopBot();

        // Notify dashboard about disconnection
        try {
            await fetch('http://localhost:8080/set_bot_disconnected', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: 'disconnected' })
            });
        } catch (err) {
            console.error('Failed to notify dashboard about disconnection:', err);
        }

        return;
    }

    reconnectAttempts++;
    console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

    // Clear existing interval
    if (messageCheckInterval) {
        clearInterval(messageCheckInterval);
        messageCheckInterval = null;
    }

    // Try to initialize the client again
    try {
        if (client.pupBrowser) {
            await client.pupBrowser.close();
        }

        // Wait before reconnecting
        const delay = reconnectAttempts * 5000; // Increasing backoff delay
        console.log(`Waiting ${delay / 1000} seconds before reconnecting...`);

        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
        }

        reconnectTimeout = setTimeout(async () => {
            try {
                await client.initialize();
                console.log('Client reinitialized successfully');

                // Restart message checking interval
                if (isBotActive && !messageCheckInterval) {
                    messageCheckInterval = setInterval(checkForNewMessages, 5000);
                }
            } catch (err) {
                console.error('Failed to reinitialize client:', err);
            }
        }, delay);
    } catch (err) {
        console.error('Error during reconnection attempt:', err);
    }
}

async function processMessage(message) {
    const ignoredTypes = [
        'e2e_notification',
        'security_notification',
        'call_log',
        'protocol',
        'gp2',
        'notification_template'
    ];

    if (ignoredTypes.includes(message.type)) {
        return;
    }

    if (processedMessageIds.has(message.id._serialized)) {
        return;
    }

    processedMessageIds.add(message.id._serialized);

    const senderId = message.from;
    const senderNumber = senderId.split('@')[0];
    const messageText = message.body || '';

    const isAdmin = ADMIN_NUMBERS.includes(senderNumber);
    const isModerator = functions.isModerator(senderNumber);
    const isBot = senderNumber === botNumber;

    if (messageText.toLowerCase().startsWith('!!')) {
        const response = await functions.handleCommand(client, assistant, message, senderNumber, isAdmin, isModerator, stopBot, startBot);
        if (response && !isBot) {
            await client.sendMessage(senderId, response);
        }
    } else if (isBotActive && !isBot && !functions.isIgnored(senderNumber)) {
        const response = await functions.storeUserMessage(client, assistant, senderNumber, message);
        if (response) {
            await client.sendMessage(senderId, response);
        }
    }
}

client.on('message_create', async (message) => {
    await processMessage(message);
});

client.on('error', (error) => {
    console.error('An error occurred:', error);
});

client.on('disconnected', async (reason) => {
    console.log('Client was disconnected:', reason);

    // Clear message checking interval
    if (messageCheckInterval) {
        clearInterval(messageCheckInterval);
        messageCheckInterval = null;
    }

    if (fs.existsSync('.wwebjs_auth')) {
        try {
            fs.rmSync('.wwebjs_auth', { recursive: true, force: true });
        } catch (error) {
            console.error('Error removing auth folder:', error);
        }
    }

    // Notify dashboard about disconnection
    try {
        await fetch('http://0.0.0.0:8080/set_bot_disconnected', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });
    } catch (error) {
        console.error('Error updating disconnected status:', error);
    }

    // Attempt to reconnect if not manually stopped
    if (isBotActive) {
        await handleReconnection();
    }
});

// Add more robust error handling
client.on('auth_failure', async (error) => {
    console.error('Authentication failure:', error);

    // Clear message checking interval
    if (messageCheckInterval) {
        clearInterval(messageCheckInterval);
        messageCheckInterval = null;
    }

    // Attempt to reconnect
    if (isBotActive) {
        await handleReconnection();
    }
});

if (!isInitialized) {
    console.log('Initializing WhatsApp client...');
    client.initialize().catch(err => {
        console.error('Failed to initialize client:', err);
        // Attempt to reconnect on initialization failure
        handleReconnection();
    });
}
