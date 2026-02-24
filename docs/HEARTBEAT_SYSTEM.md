# Heartbeat System

The Heartbeat System is a proactive notification service that periodically checks for items needing user attention and delivers alerts through configured channels.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Check Process](#check-process)
- [State Management](#state-management)
- [Agent Control](#agent-control)
- [Programmatic API](#programmatic-api)
- [HTTP API](#http-api)
- [Alert Format](#alert-format)
- [File Structure](#file-structure)
- [Troubleshooting](#troubleshooting)

---

## Overview

The heartbeat system periodically asks: **"Is there anything the user needs to know or act on?"**

```
agent.toml [heartbeat] config
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              GatewayServer                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           HeartbeatService (in-process)               │  │
│  │              */30 9-21 * * *                          │  │
│  └───────────────────────────────────────────────────────┘  │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │ 1. Check    │→ │ 2. Load   │→ │ 3. Check Working     │  │
│  │    Hours    │    │    State    │    │    Memory            │  │
│  └─────────────┘  └───────────┘  └──────────────────────┘  │
│         │                                    │              │
│         ▼                                    │              │
│  ┌──────────────────────┐                   │              │
│  │ 4. Check Background  │←──────────────────┘              │
│  │    Tasks             │                                  │
│  └──────────┬───────────┘                                  │
│             │                                              │
│             ▼                                              │
│  ┌─────────────┐  ┌───────────┐  ┌─────────────────────┐   │
│  │ 5. Collect  │→ │ 6.        │→ │ 7. Make Decision    │   │
│  │    Items    │    │ Deduplicate│    └──────────┬────────┘   │
│  └─────────────┘  └───────────┘              │            │
│                                              ▼            │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 8. Deliver Alert → handleHeartbeatAlert()          │  │
│  │    → HTTP POST to /api/agents/{id}/generate       │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Smart Scheduling** | Runs every 30 minutes during active hours (09:00-21:00) |
| **Duplicate Suppression** | 24-hour window prevents nagging (high priority bypasses) |
| **Background Tasks** | Monitors registered async operations |
| **Working Memory** | Parses task patterns from agent memory |
| **Pause/Resume** | User-controlled notification pauses |
| **Direct Integration** | Runs in-process within GatewayServer (no workflow overhead) |

---

## Quick Start

### 1. Configure in agent.toml

The heartbeat schedule and behavior are fully configured in `.agent/agent.toml`:

```toml
[heartbeat]
quiet_mode = false
alert_threshold = 1

[heartbeat.hours]
start = 9
end = 21
timezone = "Asia/Bangkok"
interval_minutes = 30

[heartbeat.checks]
task_state = true
reminders = true
context_continuity = true
background_tasks = true
message_history = true

[[heartbeat.targets]]
type = "slack"
target = "#general"
```

Enable/disable via `[services].heartbeat = true/false` in agent.toml. This generates a cron schedule: `*/30 9-21 * * *` (every 30 minutes from 9 AM to 9 PM).

### 2. Test manually

```bash
curl -X POST http://localhost:4111/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

Or ask the agent: "Run a heartbeat check now"

---

## Configuration

### Configuration Sources

| Source | Purpose | Format |
|--------|---------|--------|
| `agent.toml` | Complete heartbeat config (schedule + behavior) | TOML |
| `heartbeat-state.json` | Runtime state (suppression, pause) | JSON |

### agent.toml

Configure heartbeat in `.agent/agent.toml`:

```toml
[heartbeat]
quiet_mode = false       # If true, never notify user
alert_threshold = 1      # Minimum items before alerting

[heartbeat.hours]
start = 9                # Active hours start (0-23)
end = 21                 # Active hours end (0-23)
timezone = "Asia/Bangkok" # Timezone for active hours
interval_minutes = 30    # How often to run (generates cron)

[heartbeat.checks]
task_state = true        # Check incomplete tasks
reminders = true         # Check due reminders
context_continuity = true # Check for lost context
background_tasks = true  # Monitor background tasks

# Notification targets (used by alert handler)
[[heartbeat.targets]]
type = "slack"
target = "#alerts"

# Multiple targets supported
[[heartbeat.targets]]
type = "telegram"
target = "123456789"
```

### Generated Cron Schedule

The HeartbeatService generates a cron expression from the config:

```
*/{interval_minutes} {start}-{end} * * *
```

For example, with `interval_minutes = 30`, `start = 9`, `end = 21`:
```
*/30 9-21 * * *
```

This runs every 30 minutes from 9 AM to 9 PM in the configured timezone.

---

## Check Process

The heartbeat check is now a deterministic, in-process function (not a workflow):

### 1. Check Active Hours

Verifies current time is within configured active hours (from `agent.toml`).

- Skips if outside hours unless `force: true`
- Respects configured timezone

### 2. Load State

Loads persisted state from `.agent/heartbeat-state.json`:

- Suppression history (24h deduplication)
- Pause state
- Background task registry
- Default notification channel

Checks if paused and skips if so (unless `force: true`).

### 3. Check Working Memory

Queries agent's working memory for attention items:

| Pattern | Alert Type | Priority |
|---------|------------|----------|
| `- [ ]` | Incomplete task | low |
| `- [!]` | High priority task | high |
| `- [~]` | Blocked task | medium |
| All `[x]` | All tasks complete | low |

Alerts for high-priority and blocked tasks. All pending tasks generate low-priority alerts.

When all tasks are completed (no pending, in-progress, blocked, or high-priority remaining), the heartbeat emits an `all-tasks-complete` alert suggesting the agent archive with the `TaskArchive` tool. This alert uses `source: 'heartbeat'` so it goes through normal deduplication (fires once, then suppressed until state changes).

### 4. Check Background Tasks

Reviews registered background tasks:

| Condition | Alert Type | Priority |
|-----------|------------|----------|
| Failed task | failed-background-task | high |
| Running >30 min | long-running-task | medium |
| Pending >15 min | pending-background-task | low |

### 5. Deduplicate

Filters recently-alerted items using 24-hour suppression:

- Same item won't alert twice within 24 hours
- **High priority items bypass suppression**
- Suppression state persisted to disk

### 6. Make Decision

Evaluates results against threshold:

| Condition | Result |
|-----------|--------|
| No items | HEARTBEAT_OK (silent) |
| Items < threshold | HEARTBEAT_OK (silent) |
| Items ≥ threshold | HEARTBEAT_ALERT |
| Any high priority | HEARTBEAT_ALERT |

Generates suggested actions based on item types.

### 7. Deliver Alert

Sends notification via direct call to `handleHeartbeatAlert()`:

- Creates/gets thread for the agent
- Formats alert message
- HTTP POST to `/api/agents/{resourceId}/generate`
- Agent decides how to handle the alert

---

## State Management

### State File

State is stored in `.agent/heartbeat-state.json`:

```json
{
  "suppressedAlerts": [
    {
      "key": "high-priority-task:complete_the_report",
      "suppressedAt": "2024-01-15T10:00:00Z",
      "expiresAt": "2024-01-16T10:00:00Z",
      "priority": "medium"
    }
  ],
  "defaultChannel": {
    "channelType": "slack",
    "channelId": "C123456",
    "lastUpdated": "2024-01-15T09:00:00Z"
  },
  "pause": {
    "paused": false
  },
  "backgroundTasks": [
    {
      "id": "build-123",
      "name": "Building project",
      "status": "running",
      "registeredAt": "2024-01-15T10:00:00Z"
    }
  ],
  "lastRun": "2024-01-15T10:30:00Z",
  "lastRunStatus": "ok"
}
```

### Suppression Rules

| Priority | Bypass Suppression? |
|----------|---------------------|
| `low` | No - suppressed if duplicate |
| `medium` | No - suppressed if duplicate |
| `high` | **Yes** - always delivered |

---

## Agent Control

The agent can control heartbeat via the `heartbeat-control` tool.

### Tool Schema

**Input Schema:**
```typescript
{
  action: 'run' | 'pause' | 'resume' | 'status';
  durationMinutes?: number;  // For pause: duration in minutes (omit for indefinite)
  reason?: string;           // For pause: reason for pausing
  force?: boolean;           // For run: bypass active hours and pause checks
  resourceId?: string;       // For run: resource ID to check (defaults to current user)
}
```

**Output Schema:**
```typescript
{
  success: boolean;
  message: string;
  data?: {
    // For run action:
    status?: 'HEARTBEAT_OK' | 'HEARTBEAT_ALERT' | 'HEARTBEAT_SKIPPED';
    items?: number;
    delivered?: boolean;
    summary?: string;
    
    // For pause/resume:
    paused?: boolean;
    pausedUntil?: string;
    reason?: string;
    
    // For status:
    remainingMinutes?: number;
    lastRun?: string;
    lastRunStatus?: string;
    suppressedAlerts?: number;
    backgroundTasks?: number;
    defaultChannel?: string;
  };
}
```

### Run Manual Check

```
User: "Run a heartbeat check"
Agent: [heartbeat-control action="run" force=true]
```

**Response data:**
- `status`: Result of the check (HEARTBEAT_OK, HEARTBEAT_ALERT, HEARTBEAT_SKIPPED)
- `items`: Number of items needing attention
- `delivered`: Whether an alert was sent
- `summary`: Human-readable summary

### Pause Notifications

```
User: "Pause heartbeat for 2 hours"
Agent: [heartbeat-control action="pause" durationMinutes=120]

User: "Pause heartbeat until I say so"
Agent: [heartbeat-control action="pause"]

User: "Pause heartbeat, I'm in a meeting"
Agent: [heartbeat-control action="pause" durationMinutes=60 reason="In a meeting"]
```

**Response data:**
- `paused`: true
- `pausedUntil`: ISO timestamp when pause expires (omitted if indefinite)
- `reason`: The reason provided

### Resume Notifications

```
User: "Resume heartbeat"
Agent: [heartbeat-control action="resume"]
```

**Response data:**
- `paused`: false

### Check Status

```
User: "What's the heartbeat status?"
Agent: [heartbeat-control action="status"]
```

**Response data:**
- `paused`: Current pause state
- `remainingMinutes`: Minutes until pause expires (if paused)
- `reason`: Pause reason (if paused)
- `lastRun`: ISO timestamp of last heartbeat run
- `lastRunStatus`: Status of last run (ok, error, skipped)
- `suppressedAlerts`: Number of currently suppressed alerts
- `backgroundTasks`: Number of registered background tasks
- `defaultChannel`: Default notification channel (e.g., "slack:C123456")

---

## Programmatic API

### Using HeartbeatService Directly

```typescript
import { createHeartbeatService } from './gateway/heartbeat';

// Create service and configure adapter
const heartbeat = createHeartbeatService();
heartbeat.setAdapter(adapter);     // GatewayToMastraAdapter for memory access
heartbeat.setResourceId('default');

// Start scheduled checks
await heartbeat.start();

// Run manual check
const result = await heartbeat.runCheck({
  resourceId: 'user-123',
  force: true, // bypass active hours and pause
});

console.log(result.status); // HEARTBEAT_OK | HEARTBEAT_ALERT | HEARTBEAT_SKIPPED
console.log(result.items);  // AlertItem[]
console.log(result.summary);

// Stop scheduled checks
await heartbeat.stop();
```

### Control Pause State

```typescript
import {
  pauseHeartbeat,
  resumeHeartbeat,
  getPauseStatus,
  isPaused,
} from './workflows/heartbeat';

// Pause for 1 hour
await pauseHeartbeat({ durationMinutes: 60, reason: 'In a meeting' });

// Pause indefinitely
await pauseHeartbeat({ reason: 'On vacation' });

// Resume
await resumeHeartbeat();

// Check status
const status = await getPauseStatus();
console.log(status.paused, status.remainingMinutes);
```

### Register Background Tasks

```typescript
import {
  loadState,
  saveState,
  registerBackgroundTask,
  updateBackgroundTask,
} from './workflows/heartbeat';

// Register a task for monitoring
let state = await loadState();
state = registerBackgroundTask(state, 'build-123', 'Building project');
await saveState(state);

// Update when complete
state = await loadState();
state = updateBackgroundTask(state, 'build-123', {
  status: 'completed',
  result: 'Build successful',
});
await saveState(state);

// Or mark as failed
state = updateBackgroundTask(state, 'build-123', {
  status: 'failed',
  error: 'Build failed: missing dependency',
});
await saveState(state);
```

### Update Default Channel

```typescript
import { loadState, saveState, updateDefaultChannel } from './workflows/heartbeat';

let state = await loadState();
state = updateDefaultChannel(state, 'slack', 'C123456', 'T789');
await saveState(state);
```

---

## HTTP API

### Trigger Manual Check

```bash
curl -X POST http://localhost:4111/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "resourceId": "user-123",
    "force": true
  }'
```

### Response

```json
{
  "success": true,
  "status": "HEARTBEAT_ALERT",
  "items": [
    {
      "type": "high-priority-task",
      "description": "Complete the quarterly report",
      "priority": "high"
    }
  ],
  "suggestedActions": ["Address high-priority task immediately"],
  "summary": "1 items need attention (1 high-priority)",
  "delivered": true,
  "checkedAt": "2024-01-15T10:30:00Z"
}
```

### Send Alert Directly

```bash
curl -X POST http://localhost:4111/api/alerts/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "resourceId": "user-123",
    "alertType": "heartbeat",
    "items": [
      {
        "type": "high-priority-task",
        "description": "Complete the quarterly report",
        "priority": "high"
      }
    ],
    "summary": "1 items need attention (1 high-priority)",
    "suggestedActions": ["Address high-priority task immediately"]
  }'
```

---

## Alert Format

When items need attention, the alert message looks like:

```
## Heartbeat Alert

**Summary:** 1 items need attention (1 high-priority)

**Items requiring attention:**
🔴 [high] Complete the quarterly report

**Suggested actions:**
- Address high-priority task immediately
```

---

## File Structure

```
.agent/
├── agent.toml                  # Heartbeat config (schedule + behavior)
└── CRON.md                     # Agent-derived schedules (not heartbeat)

src/mastra/lib/config/
├── agent-config.ts             # TOML config loader
└── index.ts                    # Config exports

src/mastra/gateway/
├── heartbeat/
│   ├── index.ts                # Module exports
│   ├── service.ts              # HeartbeatService implementation
│   └── service.test.ts         # Service unit tests
├── handlers/
│   └── alert-handler.ts        # Alert delivery to agent
├── routes/
│   └── alerts.ts               # HTTP endpoints (/api/alerts/*)
└── server.ts                   # GatewayServer (hosts HeartbeatService)

src/mastra/workflows/heartbeat/  # Shared utilities (no workflow anymore)
├── config.ts                   # Config loader (reads from agent.toml)
├── state.ts                    # File-based state persistence
├── pause.ts                    # Pause/resume functionality
├── logger.ts                   # Structured logging
├── heartbeat.test.ts           # Utility unit tests
└── heartbeat.ts                # Re-exports (backward compat)

src/mastra/tools/
└── heartbeat-control.ts        # Agent tool for control

.agent/
└── heartbeat-state.json        # Persisted runtime state
```

### Logging

The heartbeat service uses structured logging via `heartbeatLogger`:

```typescript
// In service
heartbeatLogger.info({ config }, 'Loaded heartbeat config');
heartbeatLogger.stepStart('step-name', { context });
heartbeatLogger.stepEnd('step-name', startTime, { result });
heartbeatLogger.error({ error }, 'Something failed');
```

Logs include:
- Check timing and results
- Config values (enabled, hours, threshold)
- State information (pause status, item counts)
- Delivery results

---

## Troubleshooting

### Heartbeat not running

1. Check `[services].heartbeat = true` in `agent.toml`
2. Verify gateway is running: `GET /_gateway/health`
3. Check if paused: Use `heartbeat-control` with `action: status`
4. Verify active hours in `agent.toml` match current time/timezone
5. Check gateway logs for errors

### Alerts not delivered

1. Check default channel is set in state file
2. Verify alert handler is working: test with manual HTTP call
3. Check `alert_threshold` in `agent.toml`
4. Items may be suppressed - check `suppressedAlerts` in state

### Too many alerts

1. Increase `alert_threshold` in `agent.toml`
2. Suppression handles duplicates within 24h automatically
3. Use `pause` to temporarily stop notifications

### Force a check outside active hours

```bash
# Via HTTP to gateway
curl -X POST http://localhost:4111/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

Or ask the agent: "Run a heartbeat check now"

### Reset suppression state

Delete or edit `.agent/heartbeat-state.json` to clear `suppressedAlerts` array.

### Check service status

```typescript
// Get gateway instance
const gateway = getGatewayInstance();

// Check heartbeat service
const heartbeat = gateway?.getHeartbeatService();
console.log('Active:', heartbeat?.isActive());
console.log('Next run:', heartbeat?.getNextRun());
```

---

## Migration Notes

### From Workflow-based (v1) to Service-based (v2)

**Changes:**
- Heartbeat runs in-process within GatewayServer (no Mastra workflow)
- Direct memory access (no HTTP roundtrip for memory queries)
- Direct alert handler invocation (no workflow execution)
- Simpler, more reliable architecture

**Unchanged:**
- Configuration (still in `agent.toml`)
- State management (same `heartbeat-state.json` format)
- Pause/resume functionality
- Alert format and delivery
- Agent control tool interface

**API Changes:**
- Old: `POST /api/workflows/heartbeat/start-async`
- New: `POST /api/alerts/trigger`
