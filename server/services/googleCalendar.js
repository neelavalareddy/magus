import { google } from 'googleapis';

// Initialize OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback'
);

// Get authorization URL
export const getAuthUrl = () => {
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
};

// Exchange code for tokens
export const getTokensFromCode = async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    return tokens;
  } catch (error) {
    console.error('Error getting tokens:', error);
    throw error;
  }
};

// Set user credentials
export const setUserCredentials = (accessToken, refreshToken) => {
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });
};

// Get calendar events for a user
export const getUserCalendarEvents = async (accessToken, refreshToken, timeMin, timeMax) => {
  try {
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return response.data.items || [];
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    // Try to refresh token if expired
    if (error.code === 401 && refreshToken) {
      try {
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        
        // Retry with new token
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin: timeMin || new Date().toISOString(),
          timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          maxResults: 100,
          singleEvents: true,
          orderBy: 'startTime'
        });
        return response.data.items || [];
      } catch (refreshError) {
        console.error('Error refreshing token:', refreshError);
        throw refreshError;
      }
    }
    throw error;
  }
};

// Create calendar event
export const createCalendarEvent = async (accessToken, refreshToken, eventData) => {
  try {
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const event = {
      summary: eventData.title,
      description: eventData.description || '',
      start: {
        dateTime: eventData.startTime,
        timeZone: 'UTC'
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: 'UTC'
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });

    return response.data;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw error;
  }
};

// Sync calendar events to database (minimal data only - privacy-safe)
export const syncCalendarEvents = async (userId, accessToken, refreshToken, db) => {
  try {
    const events = await getUserCalendarEvents(accessToken, refreshToken);
    
    // Clear existing events for this user
    await db.query('DELETE FROM calendar_events WHERE user_id = $1', [userId]);
    
    // Insert new events - only store time blocks, no metadata
    for (const event of events) {
      if (event.start && event.end) {
        // Normalize to UTC
        const startTime = event.start.dateTime 
          ? new Date(event.start.dateTime).toISOString()
          : new Date(event.start.date + 'T00:00:00Z').toISOString();
        const endTime = event.end.dateTime
          ? new Date(event.end.dateTime).toISOString()
          : new Date(event.end.date + 'T23:59:59Z').toISOString();
        
        // Determine busy type (default to HARD for now)
        const busyType = event.transparency === 'transparent' ? 'SOFT' : 'HARD';
        
        await db.query(
          `INSERT INTO calendar_events (user_id, start_time_utc, end_time_utc, busy_type, google_event_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [userId, startTime, endTime, busyType, event.id]
        );
      }
    }
    
    return { synced: events.length };
  } catch (error) {
    console.error('Error syncing calendar events:', error);
    throw error;
  }
};

