import express from 'express';
import db from '../db/db.js';
import {
  getGroupAvailability,
  findCommonFreeTimes,
  findBestMeetingTimes,
  getFreeUsersNow,
  computeAvailabilityHeatmap,
  getUserAvailability,
  getMultipleUsersAvailability,
  findBestMeetingTime
} from '../services/availabilityEngine.js';
import { getIO } from '../services/socket.js';
import { setPresence, getPresence, clearPresence } from '../services/redis.js';

const router = express.Router();

// Get availability for a single user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { date, hours } = req.query;
    
    // Get user's calendar events
    const startDate = date ? new Date(date) : new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = date ? new Date(date) : new Date();
    endDate.setHours(23, 59, 59, 999);
    
    const eventsResult = await db.query(
      `SELECT * FROM calendar_events 
       WHERE user_id = $1 
       AND start_time_utc >= $2 
       AND start_time_utc <= $3
       ORDER BY start_time_utc ASC`,
      [userId, startDate.toISOString(), endDate.toISOString()]
    );
    
    // Parse hours if provided
    const hoursArray = hours ? hours.split(',').map(h => parseInt(h)) : [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    
    const availability = getUserAvailability(eventsResult.rows, startDate, hoursArray);
    
    res.json({ userId, date: startDate.toISOString(), availability });
  } catch (error) {
    console.error('Error fetching user availability:', error);
    res.status(500).json({ error: 'Failed to fetch user availability' });
  }
});

// Get availability for multiple users
router.post('/users', async (req, res) => {
  try {
    const { userIds, date, hours } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'User IDs array required' });
    }
    
    const startDate = date ? new Date(date) : new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = date ? new Date(date) : new Date();
    endDate.setHours(23, 59, 59, 999);
    
    // Get events for all users
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const eventsResult = await db.query(
      `SELECT * FROM calendar_events 
       WHERE user_id IN (${placeholders})
       AND start_time_utc >= $${userIds.length + 1}
       AND start_time_utc <= $${userIds.length + 2}
       ORDER BY user_id, start_time_utc ASC`,
      [...userIds, startDate.toISOString(), endDate.toISOString()]
    );
    
    // Group events by user
    const eventsByUser = {};
    eventsResult.rows.forEach(event => {
      if (!eventsByUser[event.user_id]) {
        eventsByUser[event.user_id] = [];
      }
      eventsByUser[event.user_id].push(event);
    });
    
    // Parse hours if provided
    const hoursArray = hours ? hours.split(',').map(h => parseInt(h)) : [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    
    const availability = getMultipleUsersAvailability(eventsByUser, startDate, hoursArray);
    
    res.json({ date: startDate.toISOString(), availability });
  } catch (error) {
    console.error('Error fetching users availability:', error);
    res.status(500).json({ error: 'Failed to fetch users availability' });
  }
});

// Find common free times for a group
router.post('/common', async (req, res) => {
  try {
    const { userIds, date, hours, duration } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'User IDs array required' });
    }
    
    const startDate = date ? new Date(date) : new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = date ? new Date(date) : new Date();
    endDate.setHours(23, 59, 59, 999);
    
    // Get events for all users
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const eventsResult = await db.query(
      `SELECT * FROM calendar_events 
       WHERE user_id IN (${placeholders})
       AND start_time_utc >= $${userIds.length + 1}
       AND start_time_utc <= $${userIds.length + 2}
       ORDER BY user_id, start_time_utc ASC`,
      [...userIds, startDate.toISOString(), endDate.toISOString()]
    );
    
    // Group events by user
    const eventsByUser = {};
    eventsResult.rows.forEach(event => {
      if (!eventsByUser[event.user_id]) {
        eventsByUser[event.user_id] = [];
      }
      eventsByUser[event.user_id].push(event);
    });
    
    // Parse hours if provided
    const hoursArray = hours ? hours.split(',').map(h => parseInt(h)) : [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    
    const availability = getMultipleUsersAvailability(eventsByUser, startDate, hoursArray);
    const commonTimes = findCommonFreeTimes(availability, hoursArray);
    const bestTimes = findBestMeetingTime(availability, duration || 1, hoursArray);
    
    res.json({
      date: startDate.toISOString(),
      commonFreeTimes: commonTimes,
      bestMeetingTimes: bestTimes,
      availability
    });
  } catch (error) {
    console.error('Error finding common free times:', error);
    res.status(500).json({ error: 'Failed to find common free times' });
  }
});

// Get users who are free now
router.get('/free-now', async (req, res) => {
  try {
    const { userIds } = req.query;
    
    if (!userIds) {
      return res.status(400).json({ error: 'User IDs required (comma-separated)' });
    }
    
    const userIdsArray = userIds.split(',').map(id => parseInt(id.trim()));
    const currentDate = new Date();
    const startDate = new Date(currentDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(currentDate);
    endDate.setHours(23, 59, 59, 59);
    
    // Get events for all users
    const placeholders = userIdsArray.map((_, i) => `$${i + 1}`).join(',');
    const eventsResult = await db.query(
      `SELECT * FROM calendar_events 
       WHERE user_id IN (${placeholders})
       AND start_time_utc >= $${userIdsArray.length + 1}
       AND start_time_utc <= $${userIdsArray.length + 2}
       ORDER BY user_id, start_time_utc ASC`,
      [...userIdsArray, startDate.toISOString(), endDate.toISOString()]
    );
    
    // Group events by user
    const eventsByUser = {};
    eventsResult.rows.forEach(event => {
      if (!eventsByUser[event.user_id]) {
        eventsByUser[event.user_id] = [];
      }
      eventsByUser[event.user_id].push(event);
    });
    
    const hoursArray = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const availability = getMultipleUsersAvailability(eventsByUser, currentDate, hoursArray);
    const freeUsers = getFreeUsersNow(availability);
    
    // Get user details
    const freeUserIds = freeUsers.map(id => parseInt(id));
    if (freeUserIds.length > 0) {
      const placeholders = freeUserIds.map((_, i) => `$${i + 1}`).join(',');
      const usersResult = await db.query(
        `SELECT id, name, avatar, color FROM users WHERE id IN (${placeholders})`,
        freeUserIds
      );
      res.json(usersResult.rows);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error fetching free users now:', error);
    res.status(500).json({ error: 'Failed to fetch free users' });
  }
});

// Get group availability (new UTC-based endpoint)
router.post('/group/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { window_start, window_end, resolution_minutes } = req.body;
    
    // Get group members
    const membersResult = await db.query(
      'SELECT user_id FROM group_members WHERE group_id = $1',
      [groupId]
    );
    
    if (membersResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found or has no members' });
    }
    
    const userIds = membersResult.rows.map(row => row.user_id);
    const windowStart = window_start ? new Date(window_start) : new Date();
    const windowEnd = window_end ? new Date(window_end) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const resolution = resolution_minutes || 15;
    
    // Get events for all users
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const eventsResult = await db.query(
      `SELECT * FROM calendar_events 
       WHERE user_id IN (${placeholders})
       AND start_time_utc >= $${userIds.length + 1}
       AND start_time_utc <= $${userIds.length + 2}
       ORDER BY user_id, start_time_utc ASC`,
      [...userIds, windowStart.toISOString(), windowEnd.toISOString()]
    );
    
    // Group events by user
    const eventsByUser = {};
    eventsResult.rows.forEach(event => {
      if (!eventsByUser[event.user_id]) {
        eventsByUser[event.user_id] = [];
      }
      eventsByUser[event.user_id].push(event);
    });
    
    // Compute availability with presence overrides
    const availability = await getGroupAvailability(
      eventsByUser,
      userIds,
      windowStart,
      windowEnd,
      resolution
    );
    
    // Compute heatmap
    const heatmap = computeAvailabilityHeatmap(
      availability,
      windowStart,
      windowEnd,
      resolution
    );
    
    // Find common free times
    const commonTimes = findCommonFreeTimes(
      availability,
      windowStart,
      windowEnd,
      resolution
    );
    
    res.json({
      group_id: groupId,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      resolution_minutes: resolution,
      availability,
      heatmap,
      common_free_times: commonTimes
    });
  } catch (error) {
    console.error('Error fetching group availability:', error);
    res.status(500).json({ error: 'Failed to fetch group availability' });
  }
});

// "Done Early" endpoint - sets FREE_NOW status
router.post('/done-early', async (req, res) => {
  try {
    const { userId, until } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    // Set presence to FREE_NOW
    const expiresAt = until ? new Date(until) : new Date(Date.now() + 60 * 60 * 1000); // Default 1 hour
    const presence = await setPresence(userId, 'FREE_NOW', expiresAt);
    
    if (!presence) {
      return res.status(500).json({ error: 'Failed to set presence' });
    }
    
    // Publish update
    const { publishPresenceUpdate } = await import('../services/redis.js');
    await publishPresenceUpdate(userId, presence);
    
    // Emit socket event
    const io = getIO();
    io.emit('presence-changed', {
      userId,
      status: 'FREE_NOW',
      until: expiresAt.toISOString(),
      timestamp: new Date().toISOString()
    });
    
    res.json({
      userId,
      status: 'FREE_NOW',
      until: expiresAt.toISOString(),
      message: 'Status updated to FREE_NOW'
    });
  } catch (error) {
    console.error('Error setting done early:', error);
    res.status(500).json({ error: 'Failed to set done early status' });
  }
});

// Update user status (available, busy, away, etc.) - uses Redis presence
router.post('/status', async (req, res) => {
  try {
    const { userId, status, until } = req.body;
    
    if (!userId || !status) {
      return res.status(400).json({ error: 'User ID and status required' });
    }
    
    // Valid statuses: FREE, FREE_NOW, BUSY, AWAY
    const validStatuses = ['FREE', 'FREE_NOW', 'BUSY', 'AWAY'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    
    // Set Redis presence
    const expiresAt = until ? new Date(until) : null;
    const presence = await setPresence(userId, status, expiresAt);
    
    if (!presence) {
      return res.status(500).json({ error: 'Failed to set presence' });
    }
    
    // Also update PostgreSQL for persistence
    await db.query(
      `INSERT INTO user_status (user_id, status, until)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) 
       DO UPDATE SET status = $2, until = $3, updated_at = CURRENT_TIMESTAMP`,
      [userId, status, until || null]
    );
    
    // Publish update
    const { publishPresenceUpdate } = await import('../services/redis.js');
    await publishPresenceUpdate(userId, presence);
    
    // Emit socket event
    const io = getIO();
    io.emit('presence-changed', {
      userId,
      status,
      until: expiresAt ? expiresAt.toISOString() : null,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      userId,
      status,
      until: expiresAt ? expiresAt.toISOString() : null,
      timestamp: presence.updated_at
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Get user status
router.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await db.query(
      'SELECT * FROM user_status WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ userId, status: 'available', until: null });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user status:', error);
    res.status(500).json({ error: 'Failed to fetch user status' });
  }
});

export default router;

