import { Redis } from '@upstash/redis';

let redisClient = null;

// Initialize Redis client
export const initRedis = async () => {
  try {
    redisClient = new Redis({
      url: process.env.UPSTASH_URL || process.env.REDIS_URL,
      // TODO: HotSwap — Upstash doesn't support socket reconnection strategy, handles reconnection automatically
    });

    // TODO: HotSwap — Upstash doesn't support event listeners for error/connect events
    console.log('Redis client initialized');
    return redisClient;
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    // Don't throw - app can work without Redis (degraded mode)
    return null;
  }
};

// Get Redis client
export const getRedis = () => {
  return redisClient;
};

// Presence management functions
export const setPresence = async (userId, status, expiresAt = null) => {
  if (!redisClient) return null;
  
  try {
    const key = `presence:${userId}`;
    const data = {
      status,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      updated_at: new Date().toISOString()
    };
    
    if (expiresAt) {
      const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      await redisClient.setex(key, ttl, JSON.stringify(data));
    } else {
      await redisClient.set(key, JSON.stringify(data));
    }
    
    return data;
  } catch (error) {
    console.error('Error setting presence:', error);
    return null;
  }
};

// Get presence
export const getPresence = async (userId) => {
  if (!redisClient) return null;
  
  try {
    const key = `presence:${userId}`;
    const data = await redisClient.get(key);
    
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    
    // Check if expired
    if (parsed.expires_at && new Date(parsed.expires_at) < new Date()) {
      await redisClient.del(key);
      return null;
    }
    
    return parsed;
  } catch (error) {
    console.error('Error getting presence:', error);
    return null;
  }
};

// Get multiple presences
export const getMultiplePresences = async (userIds) => {
  if (!redisClient) return {};
  
  try {
    const keys = userIds.map(id => `presence:${id}`);
    const values = await redisClient.mget(...keys);
    
    const presences = {};
    userIds.forEach((userId, index) => {
      if (values[index]) {
        try {
          const parsed = JSON.parse(values[index]);
          // Check expiration
          if (!parsed.expires_at || new Date(parsed.expires_at) >= new Date()) {
            presences[userId] = parsed;
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      }
    });
    
    return presences;
  } catch (error) {
    console.error('Error getting multiple presences:', error);
    return {};
  }
};

// Clear presence
export const clearPresence = async (userId) => {
  if (!redisClient) return;
  
  try {
    const key = `presence:${userId}`;
    await redisClient.del(key);
  } catch (error) {
    console.error('Error clearing presence:', error);
  }
};

// Check if presence overrides calendar (FREE_NOW, FREE)
export const isPresenceOverride = (presence) => {
  if (!presence) return false;
  return presence.status === 'FREE_NOW' || presence.status === 'FREE';
};

// Publish presence update to Redis pub/sub
export const publishPresenceUpdate = async (userId, presence) => {
  if (!redisClient) return;
  
  try {
    await redisClient.publish(
      'presence:updates',
      JSON.stringify({ userId, presence })
    );
  } catch (error) {
    console.error('Error publishing presence update:', error);
  }
};

export default redisClient;