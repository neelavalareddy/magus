import express from 'express';
import db from '../db/db.js';
import { getAuthUrl, getTokensFromCode } from '../services/googleCalendar.js';

const router = express.Router();

// Initiate Google OAuth flow
router.get('/google', (req, res) => {
  try {
    const authUrl = getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// Handle Google OAuth callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code missing' });
    }

    const tokens = await getTokensFromCode(code);
    
    // Get user info from Google
    const { google } = await import('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback'
    );
    
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    // Check if user exists
    const existingUser = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [userInfo.data.email]
    );
    
    let userId;
    if (existingUser.rows.length > 0) {
      // Update tokens
      await db.query(
        'UPDATE users SET google_access_token = $1, google_refresh_token = $2 WHERE email = $3',
        [tokens.access_token, tokens.refresh_token, userInfo.data.email]
      );
      userId = existingUser.rows[0].id;
    } else {
      // Create new user
      const result = await db.query(
        `INSERT INTO users (email, name, avatar, google_access_token, google_refresh_token)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          userInfo.data.email,
          userInfo.data.name,
          userInfo.data.name?.substring(0, 2).toUpperCase() || 'U',
          tokens.access_token,
          tokens.refresh_token
        ]
      );
      userId = result.rows[0].id;
    }
    
    // Redirect to frontend with user info
    const frontendUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/auth/callback?userId=${userId}&token=${tokens.access_token}`);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const userId = req.query.userId || req.headers['user-id'];
    
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }
    
    const result = await db.query('SELECT id, email, name, avatar, color FROM users WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Logout (clear tokens)
router.post('/logout', async (req, res) => {
  try {
    const userId = req.body.userId;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    await db.query(
      'UPDATE users SET google_access_token = NULL, google_refresh_token = NULL WHERE id = $1',
      [userId]
    );
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;

