const POLLING_INTERVAL = 1000;
const MAX_RETRIES = 60;
const RESPONSE_TIMEOUT = 15000; // 15 second timeout for API responses
const moderators = new Set();
let assistantKey = process.env.OPENAI_ASSISTANT_ID || '';
const userThreads = {};
const userMessages = {};
const userProcessingStatus = {};
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const threadBackups = {}; // Store thread backups in case of errors

const IGNORE_LIST_FILE = path.join(__dirname, 'ignore_list.json');
const ignoreList = new Set();

// Load image keywords data
let imageKeywordsData = {};
function loadImageKeywords() {
    try {
        const imagePath = path.join(__dirname, 'image_keywords.json');
        if (fs.existsSync(imagePath)) {
            const data = fs.readFileSync(imagePath, 'utf8');
            imageKeywordsData = JSON.parse(data);
            console.log('Image keywords loaded successfully');
        } else {
            console.log('No image keywords file found, initializing empty object');
            imageKeywordsData = {};
        }
    } catch (error) {
        console.error('Error loading image keywords:', error);
        imageKeywordsData = {};
    }
}

// Initial load of image keywords
loadImageKeywords();

// Function to find images by keywords using fuzzy matching
function findImagesByKeywords(message) {
    // Reload image keywords to ensure we have the latest data
    loadImageKeywords();

    // If no images are available, return empty array
    if (Object.keys(imageKeywordsData).length === 0) {
        return [];
    }

    // Normalize and tokenize the message
    const normalizedMessage = message.toLowerCase();
    const tokens = tokenizer.tokenize(normalizedMessage);

    // Create a map to track matched images and their matching score
    const matchedImages = new Map();

    // Check for exact keyword matches first
    for (const [keyword, images] of Object.entries(imageKeywordsData)) {
        // Check for exact match
        if (normalizedMessage.includes(keyword.toLowerCase())) {
            for (const image of images) {
                // Set a high score for exact matches
                matchedImages.set(image, (matchedImages.get(image) || 0) + 10);
            }
        }
    }

    // Check for partial keyword matches (for multi-word keywords)
    for (const [keyword, images] of Object.entries(imageKeywordsData)) {
        const keywordParts = keyword.toLowerCase().split(/\s+/);

        // Check if any keyword part is in the message
        for (const part of keywordParts) {
            if (part.length > 2 && tokens.includes(part)) {
                for (const image of images) {
                    matchedImages.set(image, (matchedImages.get(image) || 0) + 5);
                }
            }
        }
    }

    // Check for semantic similarity using sentence distance
    for (const [keyword, images] of Object.entries(imageKeywordsData)) {
        // Skip keywords that have already matched exactly
        if (normalizedMessage.includes(keyword.toLowerCase())) {
            continue;
        }

        // Check similarity for keywords with related terms like "menu", "picture", etc.
        const requestTerms = ['send', 'show', 'get', 'provide', 'share', 'view', 'see', 'photo', 'image', 'picture', 'pic'];
        const hasRequestTerm = requestTerms.some(term => normalizedMessage.includes(term));

        if (hasRequestTerm) {
            // Check if the keyword is semantically related to the message
            // This is a simple check - if the message contains words related to the keyword
            const distance = natural.JaroWinklerDistance(normalizedMessage, keyword.toLowerCase());
            if (distance > 0.7) {
                for (const image of images) {
                    matchedImages.set(image, (matchedImages.get(image) || 0) + Math.floor(distance * 5));
                }
            }
        }
    }

    // Convert the map to an array of images with scores
    const result = Array.from(matchedImages.entries())
        .map(([image, score]) => ({ image, score }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score) // Sort by score (descending)
        .map(item => item.image);

    return result;
}

// Check if message is asking for images (photos, pictures, etc.)
function isRequestingImages(message) {
    const normalizedMessage = message.toLowerCase();

    // Patterns that indicate image requests
    const imageRequestPatterns = [
        /send.*(?:menu|picture|pic|photo|image|logo)/i,
        /show.*(?:menu|picture|pic|photo|image|logo)/i,
        /(?:menu|picture|pic|photo|image|logo).*please/i,
        /can.*(?:see|get|have).*(?:menu|picture|pic|photo|image|logo)/i,
        /(?:menu|picture|pic|photo|image|logo).*\?/i
    ];

    // Check if any pattern matches
    return imageRequestPatterns.some(pattern => pattern.test(normalizedMessage));
}

// Function to send images to a user
async function sendImagesToUser(client, senderNumber, images) {
    const results = [];

    // Check if there are any images to send
    if (!images || images.length === 0) {
        return results;
    }

    // Limit to maximum 5 images to avoid spamming
    const imagesToSend = images.slice(0, 5);

    for (const imageName of imagesToSend) {
        try {
            const imagePath = path.join(__dirname, 'pics', imageName);

            // Check if file exists
            if (!fs.existsSync(imagePath)) {
                console.error(`Image file not found: ${imagePath}`);
                continue;
            }

            // Create media from file
            const media = MessageMedia.fromFilePath(imagePath);

            // Send image to user
            await client.sendMessage(`${senderNumber}@c.us`, media);
            results.push(imageName);

            // Add a small delay between sending images
            await sleep(500);
        } catch (error) {
            console.error(`Error sending image ${imageName}:`, error);
        }
    }

    return results;
}

function saveIgnoreList() {
    const ignoreArray = Array.from(ignoreList);
    try {
        const jsonData = JSON.stringify(ignoreArray, null, 2);
        fs.writeFileSync(IGNORE_LIST_FILE, jsonData, { encoding: 'utf8' });
    } catch (error) {
        console.error('Error saving ignore list:', error);
    }
}

function loadIgnoreList() {
    try {
        if (fs.existsSync(IGNORE_LIST_FILE)) {
            let data = fs.readFileSync(IGNORE_LIST_FILE, 'utf8');

            // Remove BOM and other potential invalid characters
            if (data.charCodeAt(0) === 0xFEFF) {
                data = data.slice(1);
            }

            // Clean the data of any non-printable characters
            data = data.replace(/[^\x20-\x7E\r\n]/g, '');

            if (data.trim() === '') {
                // Empty file, initialize with empty array
                ignoreList.clear();
                saveIgnoreList();
            } else {
                try {
                    // Try to parse the JSON
                    const ignoreArray = JSON.parse(data);
                    ignoreList.clear();
                    ignoreArray.forEach(number => ignoreList.add(number));
                } catch (parseError) {
                    // If JSON parsing fails, reset the file
                    console.error('Error parsing ignore list JSON, resetting file:', parseError);
                    ignoreList.clear();
                    saveIgnoreList();
                }
            }
        } else {
            // File doesn't exist, create it
            ignoreList.clear();
            saveIgnoreList();
        }
    } catch (error) {
        console.error('Error loading ignore list:', error);
        ignoreList.clear();
        saveIgnoreList();
    }
}

function addToIgnoreList(number) {
    ignoreList.add(number);
    saveIgnoreList();
    // Notify dashboard of the change
    try {
        const fetch = require('node-fetch');
        fetch('http://0.0.0.0:8080/notify_ignore_list_update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(err => console.error('Error notifying dashboard of ignore list update:', err));
    } catch (error) {
        console.error('Error requiring node-fetch or notifying dashboard:', error);
    }
}

function removeFromIgnoreList(number) {
    ignoreList.delete(number);
    saveIgnoreList();
    // Notify dashboard of the change
    try {
        const fetch = require('node-fetch');
        fetch('http://0.0.0.0:8080/notify_ignore_list_update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).catch(err => console.error('Error notifying dashboard of ignore list update:', err));
    } catch (error) {
        console.error('Error requiring node-fetch or notifying dashboard:', error);
    }
}

function isIgnored(number) {
    return ignoreList.has(number);
}

function formatMexicanNumber(number) {
    if (number.startsWith('52') && number.length === 12 && !number.startsWith('521')) {
        return `521${number.slice(2)}`;
    }
    return number;
}

async function sendMessageWithValidation(client, recipientNumber, message, senderNumber) {
    try {
        const formattedRecipient = formatMexicanNumber(recipientNumber);
        const formattedNumber = `${formattedRecipient}@c.us`;

        const isRegistered = await client.isRegisteredUser(formattedNumber);
        if (!isRegistered) {
            throw new Error('This number is not registered on WhatsApp');
        }

        await client.sendMessage(formattedNumber, message);

    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Failed to send message to ${recipientNumber}: ${error.message}`);
        throw new Error(`Failed to send message: ${error.message}`);
    }
}

function parseTimeString(timeString) {
    try {
        const [days, hours, minutes, seconds] = timeString.split(':').map(Number);
        if (isNaN(days) || isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
            throw new Error('Invalid time format.');
        }
        return (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000) + (seconds * 1000);
    } catch (error) {
        console.error(`Error in parseTimeString: ${error.message}`);
        return 0;
    }
}

function clearAllThreads() {
    try {
        // Log the number of threads being cleared
        console.log(`Clearing ${Object.keys(userThreads).length} threads`);

        // Before clearing, create backups of threads
        for (let user in userThreads) {
            // Store the thread ID in backups
            threadBackups[user] = userThreads[user];
            console.log(`Backed up thread for ${user}: ${userThreads[user]}`);
        }

        // Delete thread references
        for (let user in userThreads) {
            delete userThreads[user];
        }

        console.log("All threads have been cleared successfully");
    } catch (error) {
        console.error(`Error in clearAllThreads: ${error.message}`);
    }
}

// Function to recover thread if one exists in backups
function recoverThread(senderNumber) {
    try {
        if (threadBackups[senderNumber]) {
            console.log(`Recovering thread for ${senderNumber}: ${threadBackups[senderNumber]}`);
            userThreads[senderNumber] = threadBackups[senderNumber];
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Error recovering thread: ${error.message}`);
        return false;
    }
}

async function generateResponseOpenAI(assistant, senderNumber, userMessage, assistantKey, client) {
    try {
        // Check if userMessage is a string or an object with body property
        const messageText = typeof userMessage === 'string'
            ? userMessage
            : (userMessage && userMessage.body ? userMessage.body : '');

        if (!messageText) {
            throw new Error('Empty message received.');
        }

        let threadId;
        let isRecoveredThread = false;

        // Check if user has a thread
        if (userThreads[senderNumber]) {
            threadId = userThreads[senderNumber];
        } else {
            // Try to recover thread from backups
            if (recoverThread(senderNumber)) {
                threadId = userThreads[senderNumber];
                isRecoveredThread = true;
                console.log(`Using recovered thread for ${senderNumber}: ${threadId}`);
            } else {
                // If no thread exists or can be recovered, create a new one
                const chat = await assistant.beta.threads.create();
                threadId = chat.id;
                userThreads[senderNumber] = threadId;
                console.log(`Created new thread for ${senderNumber}: ${threadId}`);
            }
        }

        // If using a recovered thread, verify it's valid by trying to list messages
        if (isRecoveredThread) {
            try {
                // Check if the thread is valid
                await assistant.beta.threads.messages.list(threadId);
                console.log(`Recovered thread ${threadId} is valid`);
            } catch (error) {
                console.error(`Recovered thread ${threadId} is invalid, creating new thread: ${error.message}`);
                // Create new thread if recovered one is invalid
                const chat = await assistant.beta.threads.create();
                threadId = chat.id;
                userThreads[senderNumber] = threadId;
            }
        }

        // Add user message to thread
        await assistant.beta.threads.messages.create(threadId, {
            role: 'user',
            content: messageText
        });

        const tools = [
            {
                type: "function",
                function: {
                    name: "handle_human_request",
                    description: "ONLY call this function when a user EXPLICITLY requests to speak with a human representative or customer service agent. Do NOT call this for general greetings or questions that you can handle.",
                    parameters: {
                        type: "object",
                        properties: {
                            intent_confirmed: {
                                type: "boolean",
                                description: "Set to true ONLY if the user has clearly and explicitly expressed wanting to talk to a human representative (e.g., 'I want to talk to a human', 'connect me to customer service'). Set to false for general conversation."
                            },
                            user_query: {
                                type: "string",
                                description: "The user's original query or request"
                            }
                        },
                        required: ["intent_confirmed", "user_query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "handle_image_request",
                    description: "Call this function when a user is requesting images, photos, pictures, logos, or menus. This function will search for and send relevant images to the user.",
                    parameters: {
                        type: "object",
                        properties: {
                            intent_confirmed: {
                                type: "boolean",
                                description: "Set to true if the user is clearly asking for an image, photo, picture, logo, or menu. Set to false if it's unclear."
                            },
                            keywords: {
                                type: "array",
                                items: {
                                    type: "string"
                                },
                                description: "Keywords to use when searching for images (e.g., 'menu', 'logo', 'product')"
                            }
                        },
                        required: ["intent_confirmed", "keywords"]
                    }
                }
            }
        ];

        // Create run with the assistant
        const run = await assistant.beta.threads.runs.create(threadId, {
            assistant_id: assistantKey,
            tools: tools
        });

        // Set up response timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Response timeout: The assistant took too long to respond")), RESPONSE_TIMEOUT);
        });

        try {
            // Poll for run completion with timeout
            await Promise.race([
                pollRunUntilCompletion(assistant, threadId, run.id, senderNumber, client),
                timeoutPromise
            ]);

            // Fetch messages after run completes
            const messages = await assistant.beta.threads.messages.list(threadId);
            const latestMessage = messages.data[0];

            let response = '';
            if (latestMessage.content && latestMessage.content.length > 0) {
                for (const content of latestMessage.content) {
                    if (content.type === 'text') {
                        response += content.text.value.trim() + ' ';
                    }
                }
            }

            return response.trim() || "";
        } catch (error) {
            if (error.message.includes('timeout')) {
                console.error(`Response timeout for ${senderNumber} with thread ${threadId}`);

                // Try to cancel the run
                try {
                    await assistant.beta.threads.runs.cancel(threadId, run.id);
                    console.log(`Cancelled run ${run.id} due to timeout`);
                } catch (cancelError) {
                    console.error(`Failed to cancel run: ${cancelError.message}`);
                }

                return ""; // Return empty string instead of hardcoded message
            }
            throw error;
        }
    } catch (error) {
        console.error(`Error in generateResponseOpenAI: ${error.message}`);
        return ""; // Return empty string instead of hardcoded message
    }
}

// New function to handle run polling with tool calls
async function pollRunUntilCompletion(assistant, threadId, runId, senderNumber, client) {
    while (true) {
        const runStatus = await assistant.beta.threads.runs.retrieve(threadId, runId);

        if (runStatus.status === 'completed') {
            return;
        } else if (runStatus.status === 'requires_action') {
            const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
            const toolOutputs = [];

            for (const toolCall of toolCalls) {
                if (toolCall.function.name === 'handle_human_request') {
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        if (args.intent_confirmed) {
                            const result = await handleHumanRequest(senderNumber, client, global.ADMIN_NUMBERS);
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    status: "success",
                                    message: result
                                })
                            });
                        } else {
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    status: "skipped",
                                    message: "Intent not confirmed as human request"
                                })
                            });
                        }
                    } catch (error) {
                        console.error(`Error processing tool call: ${error.message}`);
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                status: "error",
                                message: "Failed to process human request"
                            })
                        });
                    }
                } else if (toolCall.function.name === 'handle_image_request') {
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        if (args.intent_confirmed) {
                            // Process image request
                            const keywords = args.keywords || [];
                            console.log(`Image request detected with keywords: ${keywords.join(', ')}`);

                            // Search for images based on keywords
                            let matchedImages = [];

                            // For each keyword, search for images
                            for (const keyword of keywords) {
                                const images = findImagesByKeywords(keyword);
                                matchedImages = [...matchedImages, ...images];
                            }

                            // Remove duplicates
                            matchedImages = [...new Set(matchedImages)];

                            // Send images to user
                            const sentImages = await sendImagesToUser(client, senderNumber, matchedImages);

                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    status: "success",
                                    message: `Sent ${sentImages.length} images matching keywords: ${keywords.join(', ')}`,
                                    images_sent: sentImages
                                })
                            });
                        } else {
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    status: "skipped",
                                    message: "Intent not confirmed as image request"
                                })
                            });
                        }
                    } catch (error) {
                        console.error(`Error processing image request: ${error.message}`);
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                status: "error",
                                message: `Failed to process image request: ${error.message}`
                            })
                        });
                    }
                }
            }

            if (toolOutputs.length > 0) {
                await assistant.beta.threads.runs.submitToolOutputs(threadId, runId, {
                    tool_outputs: toolOutputs
                });
            }
        } else if (runStatus.status === 'failed') {
            throw new Error(`Run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
        } else if (runStatus.status === 'cancelled') {
            throw new Error('Run was cancelled');
        } else if (runStatus.status === 'expired') {
            throw new Error('Run expired');
        }

        await sleep(1000);
    }
}

// Keep the existing pollRunStatus function for backward compatibility
async function pollRunStatus(client, threadId, runId) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            const run = await client.beta.threads.runs.retrieve(threadId, runId);
            if (run.status === "completed") {
                return;
            } else if (run.status === "failed" || run.status === "cancelled") {
                throw new Error(`Run ${runId} ${run.status}`);
            }
            await sleep(POLLING_INTERVAL);
            retries++;
        } catch (error) {
            console.error(`Error polling run status: ${error.message}`);
            throw new Error(`Error polling run status: ${error.message}`);
        }
    }
    throw new Error(`Run ${runId} timed out after ${MAX_RETRIES} attempts`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function addModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to add as moderator.');
        }
        moderators.add(number);
    } catch (error) {
        console.error(`Error in addModerator: ${error.message}`);
    }
}

function removeModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to remove as moderator.');
        }
        moderators.delete(number);
    } catch (error) {
        console.error(`Error in removeModerator: ${error.message}`);
    }
}

function isModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to check moderator status.');
        }
        return moderators.has(number);
    } catch (error) {
        console.error(`Error in isModerator: ${error.message}`);
        return false;
    }
}

function checkModerators() {
    try {
        return Array.from(moderators);
    } catch (error) {
        console.error(`Error in checkModerators: ${error.message}`);
        return [];
    }
}

function hasPermission(senderNumber, command, isAdmin, isModerator) {
    const unrestrictedCommands = ['!!un-sub', '!!live-chat', '!!sub', '!!bot'];
    if (unrestrictedCommands.includes(command)) {
        return true;
    }
    if (isAdmin || isModerator) {
        return true;
    }
    return false;
}

async function handleCommand(client, assistantOrOpenAI, message, senderNumber, isAdmin, isModerator, stopBot, startBot) {
    try {
        let messageText = message.body.trim();
        const [command, ...args] = messageText.split(' ');
        const lowerCommand = command.toLowerCase();

        if (lowerCommand.startsWith('!!')) {
            if (lowerCommand === '!!show-menu') {
                return showMenu(isAdmin, isModerator);
            } else if (hasPermission(senderNumber, lowerCommand, isAdmin, isModerator)) {
                switch (lowerCommand) {
                    case '!!set-key':
                        const newAssistantKey = extractQuotedString(args.join(' '));
                        if (newAssistantKey) {
                            assistantKey = newAssistantKey;
                            return 'Assistant key has been updated.';
                        } else {
                            return 'Please provide a valid assistant key using !!set-key "YourKey".';
                        }

                    case '!!add-mod':
                        const newModerator = extractQuotedString(args.join(' '));
                        if (newModerator) {
                            addModerator(newModerator);
                            return `${newModerator} is now a moderator.`;
                        } else {
                            return 'Please specify the number to add as a moderator: !!add-mod "number".';
                        }

                    case '!!remove-mod':
                        const moderatorToRemove = extractQuotedString(args.join(' '));
                        if (moderatorToRemove) {
                            removeModerator(moderatorToRemove);
                            return `${moderatorToRemove} is no longer a moderator.`;
                        } else {
                            return 'Please specify the number to remove as a moderator: !!remove-mod "number".';
                        }

                    case '!!list-mods':
                        const moderatorsList = checkModerators();
                        return `Current moderators are: ${moderatorsList.join(', ')}`;

                    case '!!clear-threads':
                        clearAllThreads();
                        return 'All threads have been cleared.';

                    case '!!show-menu':
                        if (isAdmin) {
                            return showMenu(true, false);
                        } else if (isModerator) {
                            return showMenu(false, true);
                        } else {
                            return showMenu(false, false);
                        }

                    case '!!pause':
                        if (isAdmin || isModerator) {
                            stopBot();
                            return 'Bot has been paused.';
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!start':
                        if (isAdmin || isModerator) {
                            startBot();
                            return 'Bot has been started.';
                        } else {
                            return "You don't have permission to use this command.";
                        }
                    case '!!no-assist':
                        if (isAdmin || isModerator) {
                            const chat = await message.getChat();
                            if (chat.isGroup) {
                                return "This command cannot be used in a group chat.";
                            }
                            const recipientNumber = chat.id.user;
                            addToIgnoreList(recipientNumber);
                            return `AI assistance disabled for ${recipientNumber}.`;
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!ai-assist':
                        if (isAdmin || isModerator) {
                            const chat = await message.getChat();
                            if (chat.isGroup) {
                                return "This command cannot be used in a group chat.";
                            }
                            const recipientNumber = chat.id.user;
                            removeFromIgnoreList(recipientNumber);
                            return getTemplateMessage(recipientNumber);
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!respond':
                        if (!isAdmin && !isModerator) {
                            return "You don't have permission to use this command.";
                        }

                        try {
                            const quotedStrings = extractMultipleQuotedStrings(args.join(' '));
                            if (quotedStrings.length !== 2) {
                                return 'Please use the format: !!respond "recipient_number" "your message"';
                            }

                            const [recipientNumber, responseMessage] = quotedStrings;

                            if (!recipientNumber.match(/^\d+$/)) {
                                return 'Invalid phone number format. Please provide only numbers without any special characters.';
                            }

                            await sendMessageWithValidation(client, recipientNumber, responseMessage, senderNumber);

                            return `Response sent to ${recipientNumber}`;
                        } catch (error) {
                            console.error('Error in respond command:', error);
                            return 'Failed to send response. Please check the number and try again.';
                        }

                    default:
                        return "Unknown command. Please check the available commands using !!show-menu.";
                }
            } else {
                return "You don't have permission to use this command.";
            }
        } else {
            const response = await storeUserMessage(client, assistantOrOpenAI, senderNumber, message);
            return response;
        }
    } catch (error) {
        console.error(`Error in handleCommand: ${error.message}`);
        return "An error occurred while processing your message. Our team has been notified.";
    }
}

function extractQuotedString(text) {
    try {
        const match = text.match(/"([^"]+)"/);
        return match ? match[1] : null;
    } catch (error) {
        console.error(`Error in extractQuotedString: ${error.message}`);
        return null;
    }
}

function extractMultipleQuotedStrings(text) {
    try {
        const matches = [...text.matchAll(/"([^"]+)"/g)];
        return matches.map(match => match[1]);
    } catch (error) {
        console.error(`Error in extractMultipleQuotedStrings: ${error.message}`);
        return [];
    }
}

function showMenu(isAdmin, isModerator) {
    try {
        if (isAdmin) {
            return `
*Commands Menu (Admin):*
- !!set-key: Update the assistant key
- !!add-mod: Add a moderator
- !!remove-mod: Remove a moderator
- !!list-mods: List all current moderators
- !!clear-threads: Clear all threads
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!pause: Pause the bot
- !!no-assist: Disable AI assistance for a number
- !!ai-assist: Enable AI assistance for a number
            `;
        } else if (isModerator) {
            return `
*Commands Menu (Moderator):*
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!pause: Pause the bot
- !!no-assist: Disable AI assistance for a number
- !!ai-assist: Enable AI assistance for a number
            `;
        } else {
            return `
*Commands Menu (User):*
- !!show-menu: Show the command menu
            `;
        }
    } catch (error) {
        console.error(`Error in showMenu: ${error.message}`);
        return "Sorry, unable to display the menu at this time.";
    }
}

async function storeUserMessage(client, assistantOrOpenAI, senderNumber, message) {
    try {
        if (!senderNumber || isIgnored(senderNumber)) {
            return null;
        }

        // Check if we're already processing a message for this user
        if (userProcessingStatus[senderNumber]) {
            console.log(`Already processing a message for ${senderNumber}, ignoring new message`);
            return null; // Ignore new messages while processing
        }

        // Set processing status to true for this user
        userProcessingStatus[senderNumber] = true;

        const messageText = message.body || '';

        try {
            // Get user chat for typing indicator
            const formattedSender = formatMexicanNumber(senderNumber);
            const chat = await client.getChatById(`${formattedSender}@c.us`);

            // Show typing indicator
            await chat.sendStateTyping();

            // Process the message (the image handling is now done via tools)
            const response = await processUserMessages(client, assistantOrOpenAI, senderNumber, message);

            // Clear the processing status
            userProcessingStatus[senderNumber] = false;
            return response;
        } catch (error) {
            // Make sure to clear processing status on error
            userProcessingStatus[senderNumber] = false;
            throw error;
        }
    } catch (error) {
        console.error(`Error in storeUserMessage: ${error.message}`);
        // Ensure processing status is cleared on any error
        if (senderNumber) {
            userProcessingStatus[senderNumber] = false;
        }
        return ""; // Return empty string instead of hardcoded message
    }
}

async function processImageOrDocument(assistantOrOpenAI, media, text, senderNumber) {
    try {
        if (!media || !media.data) {
            return "I couldn't process this media. Please try sending it again.";
        }

        const base64Data = media.data;
        const defaultPrompt = "What's in this image?";
        const userPrompt = text || defaultPrompt;

        // Get or create a thread for this user
        let threadId = userThreads[senderNumber];
        if (!threadId) {
            const thread = await assistantOrOpenAI.beta.threads.create();
            threadId = thread.id;
            userThreads[senderNumber] = threadId;
        }

        // Add the message with text and image to the thread
        await assistantOrOpenAI.beta.threads.messages.create(threadId, {
            role: "user",
            content: [
                {
                    type: "text",
                    text: userPrompt
                },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:${media.mimetype};base64,${base64Data}`,
                        detail: "high"
                    }
                }
            ]
        });

        // Run the assistant on the thread
        const run = await assistantOrOpenAI.beta.threads.runs.create(threadId, {
            assistant_id: assistantKey
        });

        // Poll for the run to complete
        let runStatus;
        let attempts = 0;
        const maxAttempts = 30; // Timeout after 30 attempts (30 seconds)

        while (attempts < maxAttempts) {
            runStatus = await assistantOrOpenAI.beta.threads.runs.retrieve(threadId, run.id);

            if (runStatus.status === 'completed') {
                break;
            } else if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
                throw new Error(`Run failed with status: ${runStatus.status}`);
            }

            await sleep(1000); // Wait 1 second before checking again
            attempts++;
        }

        if (attempts >= maxAttempts) {
            throw new Error('Timed out waiting for assistant response');
        }

        // Get the assistant's response
        const messages = await assistantOrOpenAI.beta.threads.messages.list(threadId);
        const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');

        if (assistantMessages.length === 0) {
            return "I couldn't generate a response. Please try again.";
        }

        // Get the most recent assistant message
        const latestMessage = assistantMessages[0];
        let responseText = "";

        // Extract text from the message content
        for (const contentPart of latestMessage.content) {
            if (contentPart.type === 'text') {
                responseText += contentPart.text.value;
            }
        }

        return responseText;
    } catch (error) {
        console.error('Error in processImageOrDocument:', error);
        return "I had trouble processing your image. Please try again later.";
    }
}

async function processUserMessages(client, assistantOrOpenAI, senderNumber, message) {
    if (senderNumber === 'status' || !senderNumber) return null;

    const isVoiceMessage = message.body && message.body.startsWith('Transcribed voice message:');
    const messageText = message.body || '';

    try {
        // Reload image keywords before processing message
        loadImageKeywords();

        // Keep typing indicator active during API call
        const formattedSender = formatMexicanNumber(senderNumber);
        const formattedSenderNumber = `${formattedSender}@c.us`;
        const chat = await client.getChatById(formattedSenderNumber);

        // Show typing indicator again to keep it active
        await chat.sendStateTyping();

        const response = await generateResponseOpenAI(assistantOrOpenAI, senderNumber, messageText, assistantKey, client);

        if (!formattedSenderNumber.match(/^\d+@c\.us$/)) {
            throw new Error(`Invalid sender number format: ${formattedSenderNumber}`);
        }

        // Only send a message if we have a non-empty response
        if (response && response.trim() !== '') {
            if (isVoiceMessage) {
                const audioBuffer = await generateAudioResponse(assistantOrOpenAI, response);
                const media = new MessageMedia('audio/ogg', audioBuffer.toString('base64'), 'response.ogg');
                await client.sendMessage(formattedSenderNumber, media, { sendAudioAsVoice: true });
            } else {
                await client.sendMessage(formattedSenderNumber, response);
            }
        }

        return null;

    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Error with ${senderNumber}: ${error.message}`);
        if (error.message.includes('invalid wid')) {
            console.warn(`Invalid WID error for ${senderNumber}: ${error.message}`);
        } else {
            // Don't send an error message to the user
            console.error(`Error processing message: ${error.message}`);
        }
        return null;
    }
}

async function transcribeAudio(assistantOrOpenAI, audioBuffer) {
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: 'audio.ogg' });
    formData.append('model', 'whisper-1');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
    });

    return response.data.text;
}

async function generateAudioResponse(assistantOrOpenAI, text) {
    const response = await assistantOrOpenAI.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: text,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
}

async function handleHumanRequest(senderNumber, client, adminNumbers) {
    try {
        if (!senderNumber || typeof senderNumber !== 'string') {
            console.error('Invalid sender number:', senderNumber);
            throw new Error('Invalid sender number');
        }

        if (!client) {
            console.error('WhatsApp client not provided');
            throw new Error('WhatsApp client not provided');
        }

        if (!adminNumbers || !Array.isArray(adminNumbers) || adminNumbers.length === 0) {
            console.error('No admin numbers available');
            throw new Error('No admin numbers configured');
        }

        const timestamp = new Date().toLocaleString();

        const notificationMessage = `
🔔 *Human Representative Request*
---------------------------
From: ${senderNumber}
Time: ${timestamp}
Status: Awaiting response
---------------------------
To respond, use: !!respond "${senderNumber}" "your message"`;

        let notifiedAdmins = 0;
        let failedNotifications = [];

        for (const adminNumber of adminNumbers) {
            try {
                const formattedAdminNumber = `${adminNumber}@c.us`;
                await client.sendMessage(formattedAdminNumber, notificationMessage);
                notifiedAdmins++;
            } catch (error) {
                failedNotifications.push(adminNumber);
                console.error(`❌ Failed to notify admin ${adminNumber}: ${error.message}`);
            }
        }

        if (notifiedAdmins === 0) {
            console.error('Failed to notify any admins about human request');
            throw new Error('Failed to reach customer service team');
        }

        return `I've forwarded your request to our customer service team. A human representative will contact you shortly. Your request has been logged at ${timestamp}. Thank you for your patience.`;
    } catch (error) {
        console.error('Error in handleHumanRequest:', error);
        return "I apologize, but I'm having trouble reaching our customer service team. Please try again in a few minutes.";
    }
}

// Function to reload image keywords data at regular intervals or on demand
setInterval(() => {
    loadImageKeywords();
}, 60000); // Reload every 60 seconds to catch new uploads

module.exports = {
    showMenu,
    parseTimeString,
    generateResponseOpenAI,
    addModerator,
    removeModerator,
    isModerator,
    checkModerators,
    handleCommand,
    sleep,
    clearAllThreads,
    recoverThread,
    storeUserMessage,
    processUserMessages,
    transcribeAudio,
    generateAudioResponse,
    loadIgnoreList,
    isIgnored,
    addToIgnoreList,
    removeFromIgnoreList,
    handleHumanRequest,
    isRequestingImages,
    findImagesByKeywords,
    loadImageKeywords,
    sendImagesToUser,
    sendMessageWithValidation
};
