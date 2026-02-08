/**
 * Availability Engine
 * Core logic for computing availability with presence overrides
 * 
 * Key principle: Presence state always overrides calendar data until it expires
 */

// Lazy import to avoid circular dependencies
let getMultiplePresences, isPresenceOverride;
const getRedisHelpers = async () => {
  if (!getMultiplePresences) {
    const redisModule = await import('./redis.js');
    getMultiplePresences = redisModule.getMultiplePresences;
    isPresenceOverride = redisModule.isPresenceOverride;
  }
  return { getMultiplePresences, isPresenceOverride };
};

// Convert UTC timestamp to hour bucket (0-23)
const getHourBucket = (utcDate, resolutionMinutes = 60) => {
  const date = new Date(utcDate);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return Math.floor(minutes / resolutionMinutes);
};

// Check if a time slot overlaps with calendar events
const hasCalendarConflict = (events, slotStart, slotEnd) => {
  return events.some(event => {
    const eventStart = new Date(event.start_time_utc);
    const eventEnd = new Date(event.end_time_utc);
    
    // Check for overlap (exclusive end)
    return eventStart < slotEnd && eventEnd > slotStart;
  });
};

// Get availability for a user with presence override
export const getUserAvailabilityWithPresence = async (
  userEvents,
  userId,
  presence,
  windowStart,
  windowEnd,
  resolutionMinutes = 15
) => {
  const availability = {};
  const slotDuration = resolutionMinutes * 60 * 1000; // milliseconds
  
  // If presence overrides (FREE_NOW or FREE), user is free
  const { isPresenceOverride: checkOverride } = await getRedisHelpers();
  const presenceOverride = presence && checkOverride(presence);
  
  // Check if presence is expired
  const presenceValid = presence && 
    (!presence.expires_at || new Date(presence.expires_at) >= new Date());
  
  let currentSlot = new Date(windowStart);
  
  while (currentSlot < windowEnd) {
    const slotEnd = new Date(currentSlot.getTime() + slotDuration);
    const slotKey = currentSlot.toISOString();
    
    if (presenceOverride && presenceValid) {
      // Presence says free - override calendar
      availability[slotKey] = {
        free: true,
        reason: presence.status === 'FREE_NOW' ? 'free_now' : 'presence_override',
        presence: presence.status
      };
    } else if (presence && presence.status === 'BUSY' && presenceValid) {
      // Presence says busy - override calendar
      availability[slotKey] = {
        free: false,
        reason: 'presence_busy',
        presence: 'BUSY'
      };
    } else {
      // Use calendar data
      const hasConflict = hasCalendarConflict(userEvents, currentSlot, slotEnd);
      availability[slotKey] = {
        free: !hasConflict,
        reason: hasConflict ? 'calendar_event' : 'free'
      };
    }
    
    currentSlot = slotEnd;
  }
  
  return availability;
};

// Get availability for multiple users (group availability)
export const getGroupAvailability = async (
  usersEvents, // { userId: [events] }
  userIds,
  windowStart,
  windowEnd,
  resolutionMinutes = 15
) => {
  // Get all presences
  const { getMultiplePresences: getPresences } = await getRedisHelpers();
  const presences = await getPresences(userIds);
  
  // Compute availability for each user
  const usersAvailability = {};
  
  for (const userId of userIds) {
    const userEvents = usersEvents[userId] || [];
    const presence = presences[userId] || null;
    
    usersAvailability[userId] = await getUserAvailabilityWithPresence(
      userEvents,
      userId,
      presence,
      windowStart,
      windowEnd,
      resolutionMinutes
    );
  }
  
  return usersAvailability;
};

// Find common free times across group
export const findCommonFreeTimes = (
  usersAvailability,
  windowStart,
  windowEnd,
  resolutionMinutes = 15
) => {
  const commonSlots = [];
  const slotDuration = resolutionMinutes * 60 * 1000;
  let currentSlot = new Date(windowStart);
  
  while (currentSlot < windowEnd) {
    const slotEnd = new Date(currentSlot.getTime() + slotDuration);
    const slotKey = currentSlot.toISOString();
    
    // Check if all users are free at this slot
    const allFree = Object.values(usersAvailability).every(
      userAvail => userAvail[slotKey] && userAvail[slotKey].free === true
    );
    
    if (allFree) {
      commonSlots.push({
        start: currentSlot.toISOString(),
        end: slotEnd.toISOString(),
        free_count: Object.keys(usersAvailability).length,
        total: Object.keys(usersAvailability).length
      });
    }
    
    currentSlot = slotEnd;
  }
  
  return commonSlots;
};

// Find best meeting times (consecutive free slots)
export const findBestMeetingTimes = (
  usersAvailability,
  windowStart,
  windowEnd,
  durationMinutes,
  resolutionMinutes = 15
) => {
  const slotDuration = resolutionMinutes * 60 * 1000;
  const requiredSlots = Math.ceil(durationMinutes / resolutionMinutes);
  const bestTimes = [];
  
  let currentSlot = new Date(windowStart);
  
  while (currentSlot < windowEnd) {
    let consecutiveFree = 0;
    let slotStart = new Date(currentSlot);
    
    // Count consecutive free slots
    while (consecutiveFree < requiredSlots && currentSlot < windowEnd) {
      const slotKey = currentSlot.toISOString();
      const allFree = Object.values(usersAvailability).every(
        userAvail => userAvail[slotKey] && userAvail[slotKey].free === true
      );
      
      if (allFree) {
        consecutiveFree++;
        currentSlot = new Date(currentSlot.getTime() + slotDuration);
      } else {
        break;
      }
    }
    
    if (consecutiveFree >= requiredSlots) {
      const slotEnd = new Date(slotStart.getTime() + (requiredSlots * slotDuration));
      bestTimes.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        duration_minutes: durationMinutes,
        participants: Object.keys(usersAvailability).length
      });
    } else {
      currentSlot = new Date(currentSlot.getTime() + slotDuration);
    }
  }
  
  return bestTimes;
};

// Get users free at a specific time
export const getFreeUsersAtTime = (usersAvailability, timeSlot) => {
  return Object.keys(usersAvailability).filter(
    userId => {
      const userAvail = usersAvailability[userId];
      const slot = userAvail[timeSlot];
      return slot && slot.free === true;
    }
  );
};

// Get users free now (current time slot)
export const getFreeUsersNow = async (usersEvents, userIds, resolutionMinutes = 15) => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - resolutionMinutes * 60 * 1000);
  const windowEnd = new Date(now.getTime() + resolutionMinutes * 60 * 1000);
  
  const availability = await getGroupAvailability(
    usersEvents,
    userIds,
    windowStart,
    windowEnd,
    resolutionMinutes
  );
  
  const currentSlot = new Date(Math.floor(now.getTime() / (resolutionMinutes * 60 * 1000)) * (resolutionMinutes * 60 * 1000));
  return getFreeUsersAtTime(availability, currentSlot.toISOString());
};

// Compute availability heatmap data for UI
export const computeAvailabilityHeatmap = (
  usersAvailability,
  windowStart,
  windowEnd,
  resolutionMinutes = 15
) => {
  const heatmap = [];
  const slotDuration = resolutionMinutes * 60 * 1000;
  let currentSlot = new Date(windowStart);
  
  while (currentSlot < windowEnd) {
    const slotEnd = new Date(currentSlot.getTime() + slotDuration);
    const slotKey = currentSlot.toISOString();
    
    let freeCount = 0;
    let totalCount = 0;
    
    Object.values(usersAvailability).forEach(userAvail => {
      totalCount++;
      if (userAvail[slotKey] && userAvail[slotKey].free === true) {
        freeCount++;
      }
    });
    
    heatmap.push({
      start: currentSlot.toISOString(),
      end: slotEnd.toISOString(),
      free_count: freeCount,
      total: totalCount,
      percentage: totalCount > 0 ? (freeCount / totalCount) * 100 : 0
    });
    
    currentSlot = slotEnd;
  }
  
  return heatmap;
};

// Legacy functions for backward compatibility (hour-based)
export const getUserAvailability = (userEvents, date = new Date(), hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) => {
  const availability = {};
  
  hours.forEach(hour => {
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    const slotEnd = new Date(date);
    slotEnd.setHours(hour + 1, 0, 0, 0);
    
    availability[hour] = !hasCalendarConflict(userEvents, slotStart, slotEnd);
  });
  
  return availability;
};

export const getMultipleUsersAvailability = (usersEvents, date = new Date(), hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) => {
  const result = {};
  
  Object.keys(usersEvents).forEach(userId => {
    result[userId] = getUserAvailability(usersEvents[userId], date, hours);
  });
  
  return result;
};

export const findBestMeetingTime = (usersAvailability, duration = 1, hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) => {
  const bestTimes = [];
  
  for (let i = 0; i <= hours.length - duration; i++) {
    const timeSlots = hours.slice(i, i + duration);
    const allFree = timeSlots.every(hour => {
      return Object.values(usersAvailability).every(
        userAvail => userAvail[hour] === true
      );
    });
    
    if (allFree) {
      bestTimes.push({
        start: timeSlots[0],
        end: timeSlots[timeSlots.length - 1] + 1,
        participants: Object.keys(usersAvailability).length
      });
    }
  }
  
  return bestTimes;
};

export const getFreeUsersAtHour = (usersAvailability, hour) => {
  return Object.keys(usersAvailability).filter(
    userId => usersAvailability[userId][hour] === true
  );
};
