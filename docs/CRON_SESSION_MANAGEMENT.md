# Cron Session Management Enhancement

This document outlines the session management enhancements implemented for the cron system, enabling flexible conversation isolation and cleanup for scheduled tasks.

## Configuration

Cron service is configured in `.agent/agent.toml`:

```toml
[cron]
cron_md_path = "CRON.md"
poll_interval_seconds = 30
thread_ttl_days = 7
cleanup_interval_ms = 3600000
```

| Option | Default | Description |
|--------|---------|-------------|
| `cron_md_path` | `"CRON.md"` | Path to the CRON.md schedule file (relative to agent.toml) |
| `poll_interval_seconds` | `30` | How often to check for CRON.md changes |
| `thread_ttl_days` | `7` | Days before isolated session threads are cleaned up |
| `cleanup_interval_ms` | `3600000` | How often to run thread cleanup (ms) |

Enable/disable via `[services].cron = true/false`.

**Note:** The cron service only processes schedules from `CRON.md`. For system-level scheduled tasks (like heartbeat checks and reflection), see `HeartbeatService` and `ReflectionService` respectively.

## Schedule Types

The cron manages two types of schedules:

| Type | Source | Purpose |
|------|--------|---------|
| **System schedules** | `agent.toml` | User-defined system tasks like heartbeat |
| **Agent-derived schedules** | `CRON.md` | Schedules created/managed by the agent |

System schedules (like heartbeat) are configured in agent.toml and cannot be modified by the agent. Agent-derived schedules live in CRON.md and can be created, updated, or removed by the agent using the `cron-manage` tool.

## Overview

The cron now supports two session modes for scheduled tasks:

- **Shared (default)**: All runs of a schedule share the same conversation history, allowing the agent to build context over time
- **Isolated**: Each run gets a fresh conversation with no memory of previous executions

## Problem Statement

Before this enhancement, all scheduled tasks shared conversation context by default. While useful for tasks like daily reports that benefit from accumulated context, this created issues for:

1. **Security scans**: Previous findings could pollute or bias current analysis
2. **Independent tasks**: Tasks that should run without any prior context
3. **Memory bloat**: Long-running schedules accumulated unbounded conversation history
4. **Stale context**: Old context could become misleading or outdated

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool → Service communication | Cron singleton via `getCron()` | Uses existing pattern, avoids circular dependencies |
| Isolated session detection | Explicit `:isolated:` prefix in key | More reliable than heuristics like UUID pattern matching |
| Session cleanup on removal | Immediate deletion | Prevents orphaned sessions when schedules are deleted |
| Memory on reset | Session mapping only | Preserves Mastra thread history for audit, generates new threadId |
| Session info display | Added to cron-list output | Users can see mode in listings without inspecting CRON.md |
| TTL for isolated sessions | 7 days | Balances cleanup vs. potential debugging needs |

## Architecture

### Session Key Patterns

```
Shared session:
  channelId: schedule:Daily_Report
  sessionKey: cron:schedule:Daily_Report

Isolated session:
  channelId: schedule:isolated:Daily_Report:550e8400-e29b-41d4-a716-446655440000
  sessionKey: cron:schedule:isolated:Daily_Report:550e8400-e29b-41d4-a716-446655440000
```

The `:isolated:` marker provides explicit, reliable detection of isolated sessions without relying on UUID pattern matching.

### Component Diagram

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  cron-manage    │────▶│ CronService  │────▶│  Thread IDs     │
│     (tool)      │     │   (singleton)    │     │  (deterministic) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │
         │                       ▼
         │              ┌──────────────────┐
         │              │  thread-utils   │
         │              │  (key patterns)  │
         │              └──────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│    CRON.md      │     │ thread-cleanup  │
│  (schedules)    │     │   (TTL timer)    │
└─────────────────┘     └──────────────────┘
```

## Implementation Details

### Files Modified/Created

| File | Type | Changes |
|------|------|---------|
| `src/mastra/gateway/cron/types.ts` | Modified | Added `ThreadMode` type and `threadMode` field |
| `src/mastra/gateway/cron/thread-utils.ts` | **New** | Session key utilities with explicit isolated prefix |
| `src/mastra/gateway/cron/thread-cleanup.ts` | **New** | TTL cleanup for isolated sessions |
| `src/mastra/gateway/cron/executor.ts` | Modified | Uses session-aware `channelId` generation |
| `src/mastra/gateway/cron/service.ts` | Modified | Added reset/cleanup methods, integrated cleanup timer |
| `src/mastra/gateway/loaders/cron-md-loader.ts` | Modified | Parse/generate `SessionMode` field |
| `src/mastra/tools/cron-manage.ts` | Modified | Added `reset-session` op, `sessionMode` param |
| `src/mastra/tools/cron-list.ts` | Modified | Added `sessionMode` to output |

### Type Definitions

```typescript
// src/mastra/gateway/cron/types.ts

export type ThreadMode = 'shared' | 'isolated';

export interface Schedule {
  name: string;
  cron: string;
  enabled: boolean;
  message?: string;
  target: ScheduleTarget;
  timezone?: string;
  workflow?: WorkflowInput;
  threadMode?: ThreadMode;  // NEW (internal type name)
}
```

### Session Utilities

The `thread-utils.ts` module provides core functions for session key management:

```typescript
// Generate channel ID based on session mode
generateScheduleChannelId(schedule: Schedule): string

// Get deterministic thread ID for a schedule
getScheduleThreadId(scheduleName: string): string

// Check if thread belongs to a schedule
isScheduleThread(threadId: string, scheduleName: string): boolean

// Detect isolated thread IDs
isIsolatedThreadId(threadId: string): boolean

// Extract schedule name from thread ID
extractScheduleNameFromThreadId(threadId: string): string | null
```

### Session Cleanup

Isolated sessions are automatically cleaned up after 7 days of inactivity:

```typescript
// src/mastra/gateway/cron/thread-cleanup.ts

// Removes isolated threads older than TTL
cleanupExpiredThreads(adapter: GatewayToMastraAdapter, resourceId: string, ttlDays: number): Promise<{ cleaned: number; schedules: string[] }>

// Started/stopped with cron service
startCleanupTimer(adapter: GatewayToMastraAdapter, resourceId: string, ttlDays: number, cleanupInterval: number): Promise<void>
stopCleanupTimer(): void
```

### CRON.md Format

The `SessionMode` field in CRON.md is optional and only written when set to `isolated`:

```markdown
## Security Scan
- **Schedule**: `0 2 * * *`
- **Message**: Run security scan on all repositories
- **Target**: slack #security-alerts
- **SessionMode**: isolated
```

Schedules without `SessionMode` default to `shared`.

**Note:** The CRON.md file uses `SessionMode` as the field name, while the TypeScript type is `ThreadMode`. The tools use `sessionMode` in their schemas.

## API Changes

### cron-manage Tool

New operation and parameter:

```typescript
inputSchema: z.object({
  operation: z.enum([
    'add', 'update', 'remove', 'enable', 'disable',
    'reset-session'  // NEW
  ]),
  // ... existing fields ...
  sessionMode: z.enum(['shared', 'isolated']).optional(),  // NEW
})

outputSchema: z.object({
  // ... existing fields ...
  sessionsDeleted: z.number().optional(),  // NEW
})
```

### cron-list Tool

New field in output:

```typescript
outputSchema: z.object({
  schedules: z.array(z.object({
    // ... existing fields ...
    sessionMode: z.enum(['shared', 'isolated']),  // NEW
  })),
})
```

### CronService

New public methods:

```typescript
class CronService {
  // Reset session for a schedule (clears conversation history)
  async resetScheduleThreads(scheduleName: string): Promise<{
    success: boolean;
    message: string;
    threadsDeleted: number;
  }>

  // Clean up sessions when schedule is removed
  async cleanupScheduleThreads(scheduleName: string): Promise<number>
}
```

## Usage Examples

### Creating an Isolated Schedule

```typescript
// Via cron-manage tool
{
  operation: 'add',
  name: 'Security Scan',
  cron: '0 2 * * *',
  message: 'Run security scan on all repositories',
  targetChannelType: 'slack',
  targetChannelId: '#security-alerts',
  threadMode: 'isolated'
}
```

### Resetting a Schedule's Session

```typescript
// Via cron-manage tool
{
  operation: 'reset-session',
  name: 'Daily Report'
}
// Response: { success: true, message: "Reset 1 session(s) for \"Daily Report\". Next run will start fresh.", sessionsDeleted: 1 }
```

### Removing a Schedule (with cleanup)

```typescript
// Via cron-manage tool
{
  operation: 'remove',
  name: 'Old Task'
}
// Response: { success: true, message: "Schedule \"Old Task\" removed successfully and cleaned up 3 session(s)" }
```

## Session Modes Explained

### Shared Mode (Default)

**Best for:**
- Daily/weekly reports that build on previous context
- Ongoing monitoring tasks
- Tasks where conversation history is valuable

**Behavior:**
- Same `threadId` across all runs
- Conversation history accumulates
- Agent can reference previous runs
- Session persists indefinitely

### Isolated Mode

**Best for:**
- Security scans (no prior bias)
- Independent analysis tasks
- Tasks that should be stateless
- High-frequency tasks (avoids memory bloat)

**Behavior:**
- Fresh `threadId` each run (UUID-based)
- No conversation history from previous runs
- Agent starts with clean slate
- Sessions auto-deleted after 7 days of inactivity

## Session Reset vs. Delete

**Reset (`reset-session` operation):**
- Clears session mapping for the schedule
- Mastra thread history preserved (audit trail)
- Next run generates new `threadId`
- Use when you want fresh context but keep history

**Remove (`remove` operation):**
- Deletes schedule from CRON.md
- Cleans up all associated sessions
- Use when schedule is no longer needed

## Backward Compatibility

This enhancement is fully backward compatible:

- Existing schedules without `threadMode` default to `'shared'`
- CRON.md files without `ThreadMode` field continue to work
- No breaking changes to existing APIs
- Existing sessions continue to function normally

## Testing Checklist

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | Add shared schedule | CRON.md shows no ThreadMode field |
| 2 | Add isolated schedule | CRON.md shows `ThreadMode: isolated` |
| 3 | List schedules | Both show `threadMode` in output |
| 4 | Run shared schedule twice | Same session key in logs |
| 5 | Run isolated schedule twice | Different session keys (with `isolated` prefix) |
| 6 | Reset shared session | Session mapping cleared, next run gets new threadId |
| 7 | Remove schedule | Associated sessions cleaned up |
| 8 | Wait 7 days (simulated) | Isolated sessions auto-deleted |

## Future Considerations

1. **Configurable TTL**: Allow per-schedule TTL configuration
2. **Session metrics**: Track session counts and cleanup stats
3. **Manual cleanup**: Tool to force cleanup of all stale sessions
4. **Session export**: Export conversation history before reset
