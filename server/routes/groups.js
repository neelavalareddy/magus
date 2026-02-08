import express from 'express';
import db from '../db/db.js';
import { getIO } from '../services/socket.js';

const router = express.Router();

// Create a new group
router.post('/', async (req, res) => {
  try {
    const { name, createdBy } = req.body;
    
    if (!name || !createdBy) {
      return res.status(400).json({ error: 'Group name and creator ID required' });
    }
    
    const result = await db.query(
      `INSERT INTO groups (name, created_by)
       VALUES ($1, $2)
       RETURNING *`,
      [name, createdBy]
    );
    
    const group = result.rows[0];
    
    // Add creator as member
    await db.query(
      `INSERT INTO group_members (group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [group.id, createdBy]
    );
    
    res.status(201).json(group);
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Get all groups for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await db.query(
      `SELECT g.*, 
              COUNT(DISTINCT gm.user_id) as member_count
       FROM groups g
       INNER JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1
       GROUP BY g.id
       ORDER BY g.created_at DESC`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get group details with members
router.get('/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    
    // Get group info
    const groupResult = await db.query(
      'SELECT * FROM groups WHERE id = $1',
      [groupId]
    );
    
    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Get members
    const membersResult = await db.query(
      `SELECT u.id, u.name, u.email, u.avatar, u.color, u.timezone, gm.joined_at
       FROM group_members gm
       INNER JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [groupId]
    );
    
    res.json({
      ...groupResult.rows[0],
      members: membersResult.rows
    });
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// Add member to group
router.post('/:groupId/members', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    
    // Check if group exists
    const groupCheck = await db.query(
      'SELECT id FROM groups WHERE id = $1',
      [groupId]
    );
    
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Add member
    const result = await db.query(
      `INSERT INTO group_members (group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING
       RETURNING *`,
      [groupId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'User already in group' });
    }
    
    // Get user details
    const userResult = await db.query(
      'SELECT id, name, email, avatar, color, timezone FROM users WHERE id = $1',
      [userId]
    );
    
    // Emit socket event
    const io = getIO();
    io.to(`group-${groupId}`).emit('member-added', {
      groupId,
      user: userResult.rows[0]
    });
    
    res.json(userResult.rows[0]);
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Remove member from group
router.delete('/:groupId/members/:userId', async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    
    const result = await db.query(
      `DELETE FROM group_members
       WHERE group_id = $1 AND user_id = $2
       RETURNING *`,
      [groupId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in group' });
    }
    
    // Emit socket event
    const io = getIO();
    io.to(`group-${groupId}`).emit('member-removed', {
      groupId,
      userId
    });
    
    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Delete group
router.delete('/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    
    const result = await db.query(
      'DELETE FROM groups WHERE id = $1 RETURNING *',
      [groupId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Emit socket event
    const io = getIO();
    io.to(`group-${groupId}`).emit('group-deleted', { groupId });
    
    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

export default router;

