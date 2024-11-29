const axios = require('axios');
const fs = require('fs');

const CALENDLY_API_KEY = 'eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzMyODI3MzM0LCJqdGkiOiI3NTZjNjA1YS00OGQzLTQzYjQtODBlMy0zYjM3MTQ1NWU2ODciLCJ1c2VyX3V1aWQiOiJmMmJhNzY3YS05Mzc5LTQ2NjItYjYyMy04NDdhMmQyMDVkMzcifQ.yW4JgxuQPYhUhDBpQhBJWD3TaEM0nfW6FNv9pRzZg7CYO70Y2r2kaBpIa34AhqOfTIlE5t35UvcYRJtHzg09Lw';
const BASE_URL = 'https://api.calendly.com';
const PROCESSED_EVENTS_FILE = 'processed_events.json';

// Helper function to load processed events
function loadProcessedEvents() {
    try {
        if (fs.existsSync(PROCESSED_EVENTS_FILE)) {
            return JSON.parse(fs.readFileSync(PROCESSED_EVENTS_FILE, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Error loading processed events:', error);
        return [];
    }
}

// Helper function to save processed events
function saveProcessedEvents(events) {
    try {
        fs.writeFileSync(PROCESSED_EVENTS_FILE, JSON.stringify(events, null, 2));
    } catch (error) {
        console.error('Error saving processed events:', error);
    }
}

// Get current user information
async function getCurrentUser() {
    try {
        const response = await axios.get(`${BASE_URL}/users/me`, {
            headers: {
                'Authorization': `Bearer ${CALENDLY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.resource.uri;
    } catch (error) {
        console.error('Failed to fetch user information:', error.message);
        return null;
    }
}

// Get event details
async function getEventDetails(eventUri) {
    try {
        const response = await axios.get(eventUri, {
            headers: {
                'Authorization': `Bearer ${CALENDLY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.resource;
    } catch (error) {
        console.error('Failed to fetch event details:', error.message);
        return {};
    }
}

// Get invitee details
async function getInviteeDetails(eventUri) {
    try {
        const response = await axios.get(`${eventUri}/invitees`, {
            headers: {
                'Authorization': `Bearer ${CALENDLY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        const invitees = response.data.collection;
        return invitees.length > 0 ? invitees[0] : {};
    } catch (error) {
        console.error('Failed to fetch invitee details:', error.message);
        return {};
    }
}

// Format event details for WhatsApp message
function formatEventMessage(event, invitee) {
    const startTime = new Date(event.start_time).toLocaleString();
    const endTime = new Date(event.end_time).toLocaleString();

    return `🗓️ *New Appointment Scheduled!*\n\n` +
           `👤 *Invitee Name:* ${invitee.name || 'N/A'}\n` +
           `📧 *Email:* ${invitee.email || 'N/A'}\n` +
           `🕒 *Start:* ${startTime}\n` +
           `🕕 *End:* ${endTime}\n` +
           `📝 *Event Type:* ${event.name || 'N/A'}\n` +
           `🔗 *Cancellation Link:* ${invitee.cancel_url || 'N/A'}`;
}

// Main function to check for new appointments
async function checkNewAppointments(client, adminNumbers) {
    try {
        const userUri = await getCurrentUser();
        if (!userUri) {
            console.error('Unable to fetch user information');
            return;
        }

        const now = new Date();
        const endTime = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days from now

        const response = await axios.get(`${BASE_URL}/scheduled_events`, {
            headers: {
                'Authorization': `Bearer ${CALENDLY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            params: {
                min_start_time: now.toISOString(),
                max_start_time: endTime.toISOString(),
                status: 'active',
                user: userUri
            }
        });

        const processedEvents = loadProcessedEvents();
        const events = response.data.collection;
        const newEvents = events.filter(event => !processedEvents.includes(event.uri));

        for (const event of newEvents) {
            const eventDetails = await getEventDetails(event.uri);
            const inviteeDetails = await getInviteeDetails(event.uri);
            const message = formatEventMessage(eventDetails, inviteeDetails);

            // Save appointment to dashboard
            const appointmentData = {
                invitee_name: inviteeDetails.name,
                invitee_email: inviteeDetails.email,
                start_time: eventDetails.start_time,
                end_time: eventDetails.end_time,
                event_type: eventDetails.name,
                status: eventDetails.status,
                cancel_url: inviteeDetails.cancel_url,
                created_at: new Date().toISOString()
            };

            // Send to dashboard API
            try {
                await fetch('http://localhost:8080/save_appointment', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(appointmentData)
                });
            } catch (error) {
                console.error('Error saving appointment to dashboard:', error);
            }

            // Send WhatsApp messages
            for (const adminNumber of adminNumbers) {
                await client.sendMessage(`${adminNumber}@c.us`, message);
            }

            processedEvents.push(event.uri);
        }

        saveProcessedEvents(processedEvents);
        return newEvents.length;
    } catch (error) {
        console.error('Error checking for new appointments:', error);
        return 0;
    }
}

module.exports = {
    checkNewAppointments
}; 