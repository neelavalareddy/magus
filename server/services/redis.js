import redis from 'redis';

let redisClient = null;

// Initialize Redis client
export const initRedis = async () => {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Redis reconnection failed after 10 retries');
            return new Error('Redis connection failed');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Connected to Redis');
    });

    await redisClient.connect();
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
      await redisClient.setEx(key, ttl, JSON.stringify(data));
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
    const values = await redisClient.mGet(keys);
    
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

