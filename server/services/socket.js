import { Server } from 'socket.io';
import { setPresence, publishPresenceUpdate, getRedis } from './redis.js';

let io = null;
let redisSubscriber = null;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join user-specific room
    socket.on('join-user-room', (userId) => {
      socket.join(`user-${userId}`);
      console.log(`User ${userId} joined their room`);
    });

    // Join group room
    socket.on('join-group', (groupId) => {
      socket.join(`group-${groupId}`);
      console.log(`Socket ${socket.id} joined group ${groupId}`);
    });

    // Leave group room
    socket.on('leave-group', (groupId) => {
      socket.leave(`group-${groupId}`);
      console.log(`Socket ${socket.id} left group ${groupId}`);
    });

    // Handle "Done Early" / presence updates
    socket.on('presence-update', async (data) => {
      const { userId, status, until } = data;
      
      try {
        // Update Redis presence
        const expiresAt = until ? new Date(until) : null;
        const presence = await setPresence(userId, status, expiresAt);
        
        if (presence) {
          // Publish to Redis pub/sub
          await publishPresenceUpdate(userId, presence);
          
          // Broadcast to all group rooms this user is in
          // (In production, you'd query which groups the user belongs to)
          io.emit('presence-changed', {
            userId,
            status,
            until: expiresAt ? expiresAt.toISOString() : null,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('Error handling presence update:', error);
        socket.emit('error', { message: 'Failed to update presence' });
      }
    });

    // Handle calendar updates
    socket.on('calendar-update', (data) => {
      const { userId, events } = data;
      // Notify group members about calendar changes
      io.emit('user-calendar-changed', { userId, events });
    });

    // Handle availability changes
    socket.on('availability-change', (data) => {
      const { userId, availability } = data;
      io.emit('user-availability-changed', { userId, availability });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  // Subscribe to Redis presence updates
  setupRedisSubscription();

  return io;
};

// Setup Redis pub/sub for presence updates
const setupRedisSubscription = async () => {
  const redis = getRedis();
  if (!redis) return;

  try {
    redisSubscriber = redis.duplicate();
    await redisSubscriber.connect();
    
    await redisSubscriber.subscribe('presence:updates', (message) => {
      try {
        const { userId, presence } = JSON.parse(message);
        
        // Broadcast to all connected clients
        if (io) {
          io.emit('presence-changed', {
            userId,
            status: presence.status,
            until: presence.expires_at,
            timestamp: presence.updated_at
          });
        }
      } catch (error) {
        console.error('Error processing Redis presence message:', error);
      }
    });
    
    console.log('Redis pub/sub subscription active');
  } catch (error) {
    console.error('Error setting up Redis subscription:', error);
  }
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

