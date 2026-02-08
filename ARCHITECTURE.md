# Magus Architecture

## Overview

Magus is a calendar availability coordination system that separates **data ingestion** from **UI control**. Google Calendar provides only raw time blocks; all visualization and interaction happens in your custom UI.

## Core Principles

1. **Google Calendar = Read-Only Data Source**
   - Only ingest: `start_time_utc`, `end_time_utc`, `busy_type`
   - Discard: titles, descriptions, locations, attendees, colors

2. **Presence Overrides Calendar**
   - Real-time status (FREE_NOW, BUSY) always takes precedence
   - Presence stored in Redis with TTL
   - Auto-expires when TTL reached

3. **Custom UI is System of Record**
   - All visualization is your own
   - All interaction logic is your own
   - Calendar providers are replaceable

## System Architecture

```
┌──────────────────────────────────────────┐
│         Custom Client UI                  │
│  • Calendar visualization                │
│  • Group heatmap                         │
│  • "Done Early" button                   │
│  • Real-time presence                    │
└───────────────────┬──────────────────────┘
                    │
        HTTPS (REST) + WebSockets
                    │
┌───────────────────▼──────────────────────┐
│            API Gateway                     │
│  • Auth (JWT/OAuth)                       │
│  • Group permissions                      │
└───────────────────┬──────────────────────┘
                    │
      ┌─────────────┴─────────────┐
      │                           │
┌─────▼───────────────┐   ┌───────▼────────────────┐
│ Calendar Ingestion  │   │ Realtime Presence      │
│ Service             │   │ Service                │
│                     │   │                        │
│ - Google OAuth      │   │ - WebSocket Server     │
│ - Fetch events      │   │ - Redis Pub/Sub        │
│ - Normalize to UTC  │   │ - Presence TTL         │
└─────┬───────────────┘   └───────┬────────────────┘
      │                             │
      └──────────────┬──────────────┘
                     ▼
        ┌────────────────────────────┐
        │   Availability Engine       │
        │                             │
        │ - Time-bucketization        │
        │ - Group intersection        │
        │ - Presence overrides        │
        └──────────────┬───────────────┘
                       │
              ┌────────▼─────────┐
              │   Data Layer      │
              │                   │
              │ PostgreSQL        │
              │ - users           │
              │ - groups          │
              │ - events (UTC)    │
              │                   │
              │ Redis             │
              │ - presence        │
              │ - realtime cache  │
              └───────────────────┘
```

## Data Flow

### Calendar Sync Flow
```
Google Calendar API
    ↓
Calendar Sync Service
    ↓
Extract: start_time_utc, end_time_utc, busy_type
    ↓
PostgreSQL (calendar_events table)
```

### "Done Early" Flow
```
[User clicks "Done Early"]
    ↓
Client emits WebSocket event
    ↓
Presence Service (Redis)
    ↓
Availability Engine
    ↓
Recompute group availability
    ↓
Broadcast to group members
```

### Read Path (UI Load)
```
Client → API Gateway
    ↓
Availability Engine
    ↓
Merge: Calendar Events + Redis Presence
    ↓
Compute intersections
    ↓
Return heatmap data
```

## Database Schema

### PostgreSQL Tables

**users**
- Stores user accounts and Google OAuth tokens
- Includes timezone for future timezone-aware features

**groups**
- User-created groups for availability coordination

**group_members**
- Many-to-many relationship between users and groups

**calendar_events** (Privacy-Safe)
- Only stores: `start_time_utc`, `end_time_utc`, `busy_type`
- No titles, descriptions, or metadata
- Indexed on `(user_id, start_time_utc, end_time_utc)`

**user_status**
- Persistent status storage (backup to Redis)

### Redis Schema

**presence:{user_id}**
- JSON: `{ status, expires_at, updated_at }`
- TTL: Based on `expires_at`

**pub/sub: presence:updates**
- Channel for broadcasting presence changes

## API Design

### Key Endpoints

**Group Availability** (Primary endpoint)
```
POST /availability/group/:groupId
{
  "window_start": "2026-01-21T09:00:00Z",
  "window_end": "2026-01-21T18:00:00Z",
  "resolution_minutes": 15
}
```

**Done Early**
```
POST /availability/done-early
{
  "userId": 1,
  "until": "2026-01-21T17:00:00Z"
}
```

**Presence Status**
```
POST /availability/status
{
  "userId": 1,
  "status": "FREE_NOW" | "FREE" | "BUSY" | "AWAY",
  "until": "2026-01-21T17:00:00Z"
}
```

## Availability Engine Logic

1. **Fetch calendar events** from PostgreSQL (UTC)
2. **Fetch presence** from Redis for all users
3. **For each time slot**:
   - If presence exists and is valid:
     - FREE_NOW or FREE → Override to free
     - BUSY → Override to busy
   - Else: Use calendar data
4. **Compute intersections** across users
5. **Return heatmap** with free/busy counts

## Real-Time Updates

### WebSocket Events

**Client → Server**
- `join-group` - Subscribe to group updates
- `presence-update` - Update own presence

**Server → Client**
- `presence-changed` - User presence updated
- `user-calendar-changed` - Calendar synced
- `member-added/removed` - Group membership changed

### Redis Pub/Sub

Presence updates are published to Redis pub/sub, which triggers WebSocket broadcasts to all connected clients in relevant groups.

## Scalability Considerations

- **Availability Engine**: Stateless, can scale horizontally
- **Redis Pub/Sub**: Handles real-time updates efficiently
- **Database**: Indexed queries for fast event lookups
- **Calendar Sync**: Can be extended to multiple providers (Apple, Outlook)

## Security & Privacy

- **OAuth**: Secure Google Calendar access
- **Minimal Data**: Only time blocks stored, no sensitive metadata
- **Group Permissions**: Users can only see availability of group members
- **Token Refresh**: Automatic Google token refresh handling

## Future Extensions

- Multiple calendar providers (Apple Calendar, Outlook)
- Timezone-aware availability
- Recurring event handling
- AI scheduling suggestions
- Confidence-weighted availability

