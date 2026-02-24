# Agent Architecture Documentation

## Session-to-Thread Migration - COMPLETED ✅

**Migration Date**: 2025-02-09  
**Status**: All session references removed, services now use GatewayToMastraAdapter HTTP methods

---

## Overview

All session-related code has been removed. Services interact with Mastra **exclusively** through `GatewayToMastraAdapter` HTTP methods. No direct Mastra imports in services.

**Architecture:**
```
Services → GatewayToMastraAdapter → Mastra HTTP API
                ↓
         (security/auth centralized)
```

---

## Implementation Summary

### Files Deleted
- ❌ `src/mastra/gateway/loaders/sessions-loader.ts`
- ❌ `src/mastra/gateway/cron/session-cleanup.ts`
- ❌ `src/mastra/gateway/cron/session-utils.ts`

### Files Created
- ✅ `src/mastra/gateway/cron/thread-utils.ts` - Thread ID generation
- ✅ `src/mastra/gateway/cron/thread-cleanup.ts` - Uses adapter HTTP methods

### Key Changes

#### 1. GatewayToMastraAdapter
Extended with HTTP methods for Mastra Memory API:

```typescript
class GatewayToMastraAdapter {
  // Thread operations
  async listThreads(resourceId: string): Promise<Thread[]>;
  async getThreadById(threadId: string): Promise<Thread | null>;
  async deleteThread(threadId: string): Promise<void>;
  
  // Message operations  
  async getThreadMessages(threadId: string): Promise<Message[]>;
  async getMessagesByResource(resourceId: string): Promise<Message[]>;
}
```

#### 2. CronService
- Removed `Memory` import
- Uses `adapter.listThreads()` + `adapter.deleteThread()` for cleanup
- `setAdapter()` and `setResourceId()` called by GatewayServer

#### 3. ReflectionService → Reflection Workflow
- `ReflectionService` (cron gateway service) replaced by `reflection-workflow.ts` (Mastra workflow)
- `ReflectorProcessor` (output processor) removed from agent pipeline
- Workflow scans memory threads directly via Mastra storage (no adapter needed)
- State persisted to JSON file (`reflection-state.json`)

#### 4. HeartbeatService
- Removed `Memory` import  
- Added `setAdapter()` method
- Uses `adapter.getThreadById()` for working memory checks

#### 5. GatewayServer
- Loads `securityConfig.resource_id` 
- Calls `setAdapter()` on all services
- Calls `setResourceId()` on all services

---

## Confirmed Mastra HTTP Routes

| Method | Route | Used By |
|--------|-------|---------|
| `GET` | `/memory/threads?resourceId=xxx` | listThreads |
| `GET` | `/memory/threads/:threadId` | getThreadById |
| `DELETE` | `/memory/threads/:threadId` | deleteThread |
| `GET` | `/memory/threads/:threadId/messages` | getThreadMessages |

---

## Security

All HTTP calls go through `GatewayToMastraAdapter` which:
- Adds `Authorization: Bearer ${GATEWAY_API_KEY}` header if configured
- Centralizes auth logic
- Services never touch Mastra directly

---

## Thread ID Format

```typescript
function generateThreadId(channelType: string, channelId: string, threadId?: string): string {
  const parts = [channelType, channelId, threadId].filter(Boolean);
  const sanitized = parts.join('_').replace(/[^a-zA-Z0-9]/g, '_');
  return `thread_${sanitized}`;
}

// Examples:
// slack:C123:T456 → thread_slack_C123_T456
// schedule:Daily_Report → thread_schedule_Daily_Report
```

---

## Configuration

```toml
[cron]
thread_ttl_days = 7
cleanup_interval_ms = 3600000
poll_interval_seconds = 30

[security]
resource_id = "interactive-agent"
```

---

## Migration Complete ✅

All components migrated:
- ✅ GatewayToMastraAdapter - HTTP methods for threads/messages
- ✅ CronService - uses adapter HTTP methods
- ✅ Reflection - migrated to Mastra workflow (no longer a gateway service)
- ✅ HeartbeatService - uses adapter HTTP methods
- ✅ GatewayServer - passes adapter to all services
- ✅ Session files removed
