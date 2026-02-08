# Magus Server

Backend API for Magus - a calendar availability coordination system.

## Architecture

This server implements a clean separation between:
- **Calendar Ingestion**: Read-only Google Calendar integration (only time blocks)
- **Custom UI**: All visualization and interaction happens in your frontend
- **Presence System**: Real-time status overrides via Redis
- **Availability Engine**: Computes intersections with presence overrides

## Key Principles

1. **Google Calendar = Data Source Only**: We only ingest `start_time_utc` and `end_time_utc`. No titles, descriptions, or metadata.
2. **Presence Overrides Calendar**: Real-time status (FREE_NOW, BUSY) always takes precedence over calendar data.
3. **Privacy-First**: Calendar events stored as anonymous time blocks only.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up PostgreSQL database:
```bash
createdb magus
```

3. Set up Redis (optional - app works without it but presence features will be limited):
```bash
redis-server
```

4. Configure environment variables (copy `.env.example` to `.env`):
```bash
cp .env.example .env
# Edit .env with your values
```

5. Start the server:
```bash
npm start
# or for development with auto-reload:
npm run dev
```

## API Endpoints

### Authentication (`/auth`)

- `GET /auth/google` - Get Google OAuth URL
- `GET /auth/google/callback` - Handle OAuth callback
- `GET /auth/me?userId=<id>` - Get current user
- `POST /auth/logout` - Logout user

### Groups (`/groups`)

- `POST /groups` - Create a new group
  ```json
  {
    "name": "Study Group",
    "createdBy": 1
  }
  ```

- `GET /groups/user/:userId` - Get all groups for a user
- `GET /groups/:groupId` - Get group details with members
- `POST /groups/:groupId/members` - Add member to group
  ```json
  {
    "userId": 2
  }
  ```
- `DELETE /groups/:groupId/members/:userId` - Remove member
- `DELETE /groups/:groupId` - Delete group

### Calendar (`/calendar`)

- `POST /calendar/sync` - Sync Google Calendar events
  ```json
  {
    "userId": 1,
    "timeMin": "2026-01-21T00:00:00Z",
    "timeMax": "2026-01-28T00:00:00Z"
  }
  ```

- `GET /calendar/events?userId=<id>&date=<iso-date>` - Get user's events
- `POST /calendar/events/batch` - Get events for multiple users
  ```json
  {
    "userIds": [1, 2, 3],
    "date": "2026-01-21"
  }
  ```

- `POST /calendar/events` - Create calendar event (writes to Google Calendar)

### Availability (`/availability`)

- `GET /availability/user/:userId?date=<iso-date>&hours=9,10,11` - Get user availability (legacy hour-based)
- `POST /availability/users` - Get multiple users' availability (legacy)
- `POST /availability/common` - Find common free times (legacy)

- `POST /availability/group/:groupId` - **Get group availability (new UTC-based)**
  ```json
  {
    "window_start": "2026-01-21T09:00:00Z",
    "window_end": "2026-01-21T18:00:00Z",
    "resolution_minutes": 15
  }
  ```
  Returns:
  ```json
  {
    "group_id": 1,
    "window_start": "...",
    "window_end": "...",
    "resolution_minutes": 15,
    "availability": { ... },
    "heatmap": [ ... ],
    "common_free_times": [ ... ]
  }
  ```

- `POST /availability/done-early` - **Set "Done Early" status**
  ```json
  {
    "userId": 1,
    "until": "2026-01-21T17:00:00Z"  // optional, defaults to 1 hour
  }
  ```

- `POST /availability/status` - Update user presence status
  ```json
  {
    "userId": 1,
    "status": "FREE_NOW" | "FREE" | "BUSY" | "AWAY",
    "until": "2026-01-21T17:00:00Z"  // optional
  }
  ```

- `GET /availability/status/:userId` - Get user status
- `GET /availability/free-now?userIds=1,2,3` - Get users free now

## WebSocket Events

### Client → Server

- `join-user-room` - Join user-specific room
- `join-group` - Join group room for real-time updates
- `leave-group` - Leave group room
- `presence-update` - Update presence status
  ```json
  {
    "userId": 1,
    "status": "FREE_NOW",
    "until": "2026-01-21T17:00:00Z"
  }
  ```

### Server → Client

- `presence-changed` - Presence status changed
  ```json
  {
    "userId": 1,
    "status": "FREE_NOW",
    "until": "2026-01-21T17:00:00Z",
    "timestamp": "2026-01-21T16:00:00Z"
  }
  ```

- `user-calendar-changed` - User's calendar synced
- `member-added` - Member added to group
- `member-removed` - Member removed from group
- `group-deleted` - Group deleted

## Database Schema

### users
- `id`, `email`, `name`, `avatar`, `color`, `timezone`
- `google_access_token`, `google_refresh_token`

### groups
- `id`, `name`, `created_by`, `created_at`

### group_members
- `id`, `group_id`, `user_id`, `joined_at`

### calendar_events (Privacy-Safe)
- `id`, `user_id`
- `start_time_utc`, `end_time_utc`, `busy_type` (HARD|SOFT)
- `google_event_id`

### user_status
- `id`, `user_id`, `status`, `until`, `updated_at`

## Redis Schema

### Presence
- Key: `presence:{user_id}`
- Value: JSON with `status`, `expires_at`, `updated_at`
- TTL: Set based on `expires_at`

### Pub/Sub
- Channel: `presence:updates`
- Messages: `{ userId, presence }`

## Environment Variables

See `.env.example` for all required variables.

## Development

The server uses ES modules (`type: "module"`). All imports must use `.js` extension.

## Architecture Notes

- **Calendar Sync**: Only stores time blocks, discards all metadata
- **Presence Override**: Redis presence always overrides calendar data
- **Availability Engine**: Stateless, computes on-demand with presence integration
- **Scalability**: Can add more calendar providers by extending `googleCalendar.js` pattern

