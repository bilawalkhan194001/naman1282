require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const OpenAI = require('openai');
const functions = require('./functions');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const assistant = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox'],
    }
});

const adminNumber = ['923499490427'];
console.log(adminNumber); // Example usage
let isBotActive = true; // Control the bot's active state

// Add these variables to store the last messages
let lastBotMessage = '';
let lastHumanMessage = '';

// Get the bot's own number after client is ready
let botNumber = '';

// Add this variable to store the timestamp of the last processed message
let lastProcessedMessageTime = 0;

// Add this Set to keep track of processed message IDs
const processedMessageIds = new Set();

// Add near the start of the file, after the requires
const picsFolder = path.join(__dirname, 'pics');
if (!fs.existsSync(picsFolder)) {
    console.log('Creating pics folder...');
    fs.mkdirSync(picsFolder);
}

// Add this flag at the top with other variables
let isResetMode = false;

function stopBot() {
    isBotActive = false;
    console.log('Bot has been paused.');
}

function startBot() {
    isBotActive = true;
    console.log('Bot is now active.');
}

// Example logging to a file
function logEvent(message) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync('bot.log', `[${timestamp}] ${message}\n`);
    console.log(`[${timestamp}] ${message}`); // Also log to console for real-time monitoring
}

logEvent('Bot initialization started.');

client.on('qr', (qr) => {
    logEvent('QR Code received, generating image...');
    qrcode.toFile('qr_code.png', qr, {
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    }, (err) => {
        if (err) {
            logEvent(`Error generating QR code: ${err}`);
            console.error('Error generating QR code:', err);
        } else {
            logEvent('QR code image generated successfully.');
        }
    });
});

client.on('ready', async () => {
    logEvent('Client is ready!');
    botNumber = client.info.wid.user;
    logEvent(`Bot number: ${botNumber}`);

    if (!adminNumber.includes(botNumber)) {
        adminNumber.push(botNumber);
        logEvent(`Bot number ${botNumber} added to admin list.`);
    }

    functions.loadIgnoreList();
    
    setInterval(checkForNewMessages, 1000);

    // Notify the server that the bot is connected
    fetch('http://localhost:8080/set_bot_connected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    })
    .then(response => response.json())
    .then(data => {
        logEvent(`Server notification: ${data.message}`);
    })
    .catch(error => {
        logEvent(`Error updating bot status: ${error}`);
        console.error('Error updating bot status:', error);
    });
});

async function checkForNewMessages() {
    try {
        const chat = await client.getChatById(`${botNumber}@c.us`);
        const messages = await chat.fetchMessages({ limit: 1 });

        if (messages.length > 0) {
            const latestMessage = messages[0];

            // Only process messages from the bot's number
            if (latestMessage.from === `${botNumber}@c.us`) {
                // Check if this message is newer than the last processed message and hasn't been processed yet
                if (latestMessage.timestamp > lastProcessedMessageTime && !processedMessageIds.has(latestMessage.id._serialized)) {
                    lastProcessedMessageTime = latestMessage.timestamp;

                    // Process the message
                    await processMessage(latestMessage);
                }
            }
        }
    } catch (error) {
        console.error('Error checking for new messages:', error);
    }
}

async function processMessage(message) {
    if (message.type === 'e2e_notification') {
        console.log('Ignoring e2e_notification message');
        return;
    }

    if (processedMessageIds.has(message.id._serialized)) {
        return;
    }

    processedMessageIds.add(message.id._serialized);

    const senderId = message.from;
    const senderNumber = senderId.split('@')[0];
    const messageText = message.body || '';

    const isAdmin = adminNumber.includes(senderNumber);
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
    } else if (isBot) {
        // No action needed for bot's own message
    }
}

client.on('message_create', async (message) => {
    await processMessage(message);
});

client.on('error', (error) => {
    logEvent(`An error occurred: ${error.message}`);
    console.error('An error occurred:', error);
});

client.on('disconnected', (reason) => {
    logEvent(`Client was disconnected: ${reason}`);
    
    // Notify the dashboard that the bot is disconnected
    fetch('http://localhost:8080/set_bot_disconnected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    }).then(() => {
        logEvent('Dashboard notified of bot disconnection.');
    }).catch(error => {
        logEvent(`Error updating disconnected status: ${error}`);
        console.error('Error updating disconnected status:', error);
    });
});

client.initialize();

logEvent('Bot initialized successfully.');
