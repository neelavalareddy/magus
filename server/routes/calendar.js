import express from 'express';
import db from '../db/db.js';
import { syncCalendarEvents, getUserCalendarEvents, createCalendarEvent } from '../services/googleCalendar.js';
import { getIO } from '../services/socket.js';

const router = express.Router();

// Sync calendar events from Google Calendar
router.post('/sync', async (req, res) => {
  try {
    const { userId, timeMin, timeMax } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    // Get user tokens
    const userResult = await db.query(
      'SELECT google_access_token, google_refresh_token FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { google_access_token, google_refresh_token } = userResult.rows[0];
    
    if (!google_access_token) {
      return res.status(401).json({ error: 'User not authenticated with Google Calendar' });
    }
    
    // Sync events
    const events = await syncCalendarEvents(
      userId,
      google_access_token,
      google_refresh_token,
      db
    );
    
    // Emit socket event
    const io = getIO();
    io.emit('user-calendar-changed', { userId, events });
    
    res.json({ message: 'Calendar synced successfully', events });
  } catch (error) {
    console.error('Error syncing calendar:', error);
    res.status(500).json({ error: 'Failed to sync calendar' });
  }
});

// Get user's calendar events from database
router.get('/events', async (req, res) => {
  try {
    const { userId, date } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    let query = 'SELECT * FROM calendar_events WHERE user_id = $1';
    const params = [userId];
    
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      
      query += ' AND start_time_utc >= $2 AND start_time_utc <= $3';
      params.push(startDate.toISOString(), endDate.toISOString());
    } else {
      // Default to today and next 7 days
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);
      endDate.setHours(23, 59, 59, 999);
      
      query += ' AND start_time_utc >= $2 AND start_time_utc <= $3';
      params.push(startDate.toISOString(), endDate.toISOString());
    }
    
    query += ' ORDER BY start_time_utc ASC';
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// Get calendar events for multiple users
router.post('/events/batch', async (req, res) => {
  try {
    const { userIds, date } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'User IDs array required' });
    }
    
    const startDate = date ? new Date(date) : new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = date ? new Date(date) : new Date();
    endDate.setDate(endDate.getDate() + 7);
    endDate.setHours(23, 59, 59, 999);
    
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const query = `
      SELECT * FROM calendar_events 
      WHERE user_id IN (${placeholders})
      AND start_time_utc >= $${userIds.length + 1}
      AND start_time_utc <= $${userIds.length + 2}
      ORDER BY user_id, start_time_utc ASC
    `;
    
    const params = [...userIds, startDate.toISOString(), endDate.toISOString()];
    const result = await db.query(query, params);
    
    // Group by user ID
    const eventsByUser = {};
    result.rows.forEach(event => {
      if (!eventsByUser[event.user_id]) {
        eventsByUser[event.user_id] = [];
      }
      eventsByUser[event.user_id].push(event);
    });
    
    res.json(eventsByUser);
  } catch (error) {
    console.error('Error fetching batch calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// Create a new calendar event
router.post('/events', async (req, res) => {
  try {
    const { userId, title, description, startTime, endTime } = req.body;
    
    if (!userId || !title || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Get user tokens
    const userResult = await db.query(
      'SELECT google_access_token, google_refresh_token FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { google_access_token, google_refresh_token } = userResult.rows[0];
    
    if (!google_access_token) {
      return res.status(401).json({ error: 'User not authenticated with Google Calendar' });
    }
    
    // Create event in Google Calendar
    const googleEvent = await createCalendarEvent(
      google_access_token,
      google_refresh_token,
      { title, description, startTime, endTime }
    );
    
    // Save to database (minimal data only)
    const result = await db.query(
      `INSERT INTO calendar_events (user_id, start_time_utc, end_time_utc, busy_type, google_event_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, startTime, endTime, 'HARD', googleEvent.id]
    );
    
    // Emit socket event
    const io = getIO();
    io.emit('user-calendar-changed', { userId, events: [result.rows[0]] });
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

export default router;

