# HeartbeatService API Documentation

**Status:** ✅ Implemented  
**Location:** `src/mastra/gateway/heartbeat/service.ts`  
**Purpose:** Automated monitoring and alerting for tasks, background jobs, and system health

---

## Overview

HeartbeatService provides **in-process, cron-based monitoring** of:
- Working memory tasks (high-priority, blocked, pending)
- Background task execution status
- Alert deduplication and suppression
- Timezone-aware active hours

**Key Design Decision:** Service-based architecture (replaced workflow-based approach for lower overhead and direct memory access).

---

## Quick Start

### Basic Usage

```typescript
import { createHeartbeatService } from './gateway/heartbeat';

// Create service and configure adapter
const heartbeat = createHeartbeatService();
heartbeat.setAdapter(adapter);     // GatewayToMastraAdapter for memory access
heartbeat.setResourceId('default');

// Start (loads config from agent.toml [heartbeat] section)
await heartbeat.start();

// Check status
console.log(heartbeat.isActive()); // true
console.log(heartbeat.getNextRun()); // Date of next scheduled run

// Manual check (bypasses schedule)
const result = await heartbeat.runCheck({ force: true });
console.log(result.status); // 'HEARTBEAT_OK' | 'HEARTBEAT_ALERT' | ...

// Stop
await heartbeat.stop();
```

---

## Configuration

### agent.toml

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
```

---

## API Reference

### Types

```typescript
interface HeartbeatServiceConfig {
  resourceId?: string;         // Resource identifier (default: 'default')
}

interface HeartbeatResult {
  status: 'HEARTBEAT_OK' | 'HEARTBEAT_ALERT' | 'HEARTBEAT_SKIPPED' | 'HEARTBEAT_ERROR';
  items: AlertItem[];          // Items needing attention
  summary: string;             // Human-readable summary
  delivered: boolean;          // Whether alert was delivered
  checkedAt: string;           // ISO timestamp
}

interface AlertItem {
  type: string;                // e.g., 'high-priority-task', 'blocked-task'
  description: string;
  priority: 'low' | 'medium' | 'high';
  source: string;              // 'working-memory' | 'background-tasks'
}
```

### Class: HeartbeatService

#### Constructor

```typescript
constructor(config: HeartbeatServiceConfig)
```

#### Methods

##### `start(): Promise<void>`

Starts the heartbeat service with CRON scheduling.

```typescript
await heartbeat.start();
```

**Behavior:**
- Loads configuration from `agent.toml [heartbeat]`
- Validates settings
- Starts CRON job with `croner`
- Logs next scheduled run time

**Errors:** Non-fatal; logs error but doesn't throw

---

##### `stop(): Promise<void>`

Stops the heartbeat service and cancels CRON job.

```typescript
await heartbeat.stop();
```

---

##### `runCheck(options?: { force?: boolean; resourceId?: string }): Promise<HeartbeatResult>`

Executes a single heartbeat check.

```typescript
// Scheduled run (respects active hours, pause file)
const result = await heartbeat.runCheck();

// Forced run (bypasses active hours and pause)
const result = await heartbeat.runCheck({ force: true });

// Different resource
const result = await heartbeat.runCheck({ resourceId: 'user-123' });
```

**Check Sequence:**
1. Check enabled status
2. Check active hours (unless forced)
3. Check pause file (unless forced)
4. Load and clean state
5. Check working memory → items
6. Check background tasks → items
7. Deduplicate items (suppression)
8. Generate summary
9. If meets threshold → deliver alert
10. Return result

---

##### `isActive(): boolean`

Returns whether the service is running.

```typescript
if (heartbeat.isActive()) {
  console.log('Next run:', heartbeat.getNextRun());
}
```

---

##### `getNextRun(): Date | null`

Returns the next scheduled run time.

```typescript
const nextRun = heartbeat.getNextRun();
console.log(`Next check: ${nextRun?.toISOString()}`);
```

---

## Alert Types

### Working Memory Alerts

| Type | Trigger | Priority |
|------|---------|----------|
| `high-priority-task` | Task marked `!` in working memory | high |
| `blocked-task` | Task marked `~` in working memory | medium |
| `pending-tasks` | 5+ pending tasks (`[ ]`) | low |

### Background Task Alerts

| Type | Trigger | Priority |
|------|---------|----------|
| `long-running-task` | Task running >30 minutes | medium |
| `pending-background-task` | Task pending >15 minutes | low |
| `failed-background-task` | Task failed (within 24h) | high |

---

## State Management

State is persisted to `.agent/heartbeat-state.json`:

```typescript
interface HeartbeatState {
  suppressedAlerts: Array<{
    key: string;
    suppressedAt: string;
    expiresAt: string;
    priority: string;
  }>;
  defaultChannel?: {
    channelType: string;
    channelId: string;
    threadId?: string;
    lastUpdated: string;
  };
  pause: {
    paused: boolean;
    pausedAt?: string;
    pausedUntil?: string;
    reason?: string;
  };
  backgroundTasks: BackgroundTask[];
  lastRun?: string;
  lastRunStatus?: 'ok' | 'alert' | 'error' | 'skipped';
}
```

### Suppression

All alert priorities use a single 24-hour suppression duration. High-priority items bypass suppression entirely (always delivered).

| Priority | Suppressed? |
|----------|-------------|
| high | **No** — always delivered |
| medium | Yes — 24 hours |
| low | Yes — 24 hours |

---

## Integration Examples

### GatewayServer Integration

```typescript
// src/mastra/gateway/server.ts
export class GatewayServer {
  private heartbeat: HeartbeatService | null = null;
  private adapter: GatewayToMastraAdapter;

  async start(config: GatewayConfig): Promise<void> {
    // ... channel setup, adapter creation ...

    // Initialize heartbeat service
    this.heartbeat = createHeartbeatService();
    this.heartbeat.setAdapter(this.adapter);
    this.heartbeat.setResourceId(resourceId);
    await this.heartbeat.start();
  }

  async stop(): Promise<void> {
    if (this.heartbeat) {
      await this.heartbeat.stop();
    }
    // ... other cleanup ...
  }

  // Accessor for manual checks
  getHeartbeatService(): HeartbeatService | null {
    return this.heartbeat;
  }
}
```

### Manual Check via Tool

```typescript
// src/mastra/tools/heartbeat-control.ts
export const heartbeatControlTool = createTool({
  id: 'heartbeat-control',
  description: 'Run or control heartbeat checks',
  inputSchema: z.object({
    action: z.enum(['run', 'pause', 'resume', 'status']),
  }),
  execute: async ({ context }) => {
    const gateway = getGatewayServer();
    const heartbeat = gateway.getHeartbeatService();

    if (!heartbeat) {
      return { error: 'Heartbeat not initialized' };
    }

    switch (context.action) {
      case 'run':
        const result = await heartbeat.runCheck({ force: true });
        return { status: result.status, items: result.items };
      // ...
    }
  },
});
```

---

## Testing

```typescript
// service.test.ts
import { describe, it, expect } from 'vitest';
import { createHeartbeatService } from './service';

describe('HeartbeatService', () => {
  it('should detect high-priority tasks', async () => {
    const heartbeat = createHeartbeatService();
    heartbeat.setResourceId('test');
    
    // Setup: Create high-priority task in working memory
    // ...
    
    const result = await heartbeat.runCheck({ force: true });
    
    expect(result.items).toContainEqual(
      expect.objectContaining({
        type: 'high-priority-task',
        priority: 'high',
      })
    );
  });
});
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Heartbeat disabled" | `[services].heartbeat = false` in agent.toml | Set `[services].heartbeat = true` |
| "Outside active hours" | Current time outside configured hours | Adjust `hours.start/end` in agent.toml or use `force: true` |
| "Heartbeat is paused" | Pause state is set | Call `resumeHeartbeat()` or clear pause in `heartbeat-state.json` |
| No alerts delivered | Below `alert_threshold` or suppressed | Check threshold, wait for suppression expiry |

### Debug Logging

Enable debug logs:

```typescript
import { heartbeatLogger } from './workflows/heartbeat/logger';

heartbeatLogger.level = 'debug';
```

---

## Migration from Workflow

If you were using the old workflow-based heartbeat:

```typescript
// OLD (deprecated)
import { heartbeatWorkflow } from './workflows/heartbeat';
await mastra.runWorkflow('heartbeat', { ... });

// NEW (current)
import { createHeartbeatService } from './gateway/heartbeat';
const heartbeat = createHeartbeatService();
heartbeat.setAdapter(adapter);
heartbeat.setResourceId(resourceId);
await heartbeat.start();
```

**Benefits:**
- Direct memory access (no HTTP overhead)
- Simpler error handling
- Better testability
- Lower resource usage

---

*Document Version: 1.0*  
*Last Updated: 2026-02-09*
