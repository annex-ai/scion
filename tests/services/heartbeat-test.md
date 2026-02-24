# Heartbeat Service Test

> Tests the HeartbeatService's ability to detect incomplete tasks in working memory
> and send alerts to agents via the Gateway HTTP API for decision-making.

## Prerequisites

- GatewayServer running with HeartbeatService enabled
- Heartbeat enabled in `agent.toml [heartbeat]`
- sharedMemory accessible
- Gateway alert endpoint configured (`/api/alerts/heartbeat`)

## Architecture Note

The heartbeat refactor changed alert delivery:

```
Before: Heartbeat → Channel Adapter → User
After:  Heartbeat → Gateway HTTP API → Agent → (decides) → User
```

The **agent** is now the central decision-maker for all heartbeat communications.

## Test Setup

```bash
# Ensure heartbeat is enabled and not paused
curl -X POST http://localhost:3000/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{"action":"resume"}'

# Verify agent is reachable
curl http://localhost:4111/api/agents/interactive-agent
```

## Test Scenario: Interrupted Task List

### Step 1: Agent Creates Working Memory with Tasks

**Agent Action:** Update working memory with incomplete tasks

```markdown
# Working Memory

## Tasks
- [!] Critical: Complete quarterly report analysis
- [~] Blocked: Waiting for API credentials from DevOps
- [ ] Review PR #1234 from Sarah
- [ ] Update documentation for new feature
- [ ] Schedule team retro
- [ ] Prepare presentation slides
```

**Expected:** Working memory persisted to thread metadata

### Step 2: Trigger Heartbeat Check

**Manual Trigger:**
```bash
curl -X POST http://localhost:3000/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{"resourceId": "default", "force": true}'
```

**Expected HTTP Flow:**

1. **Heartbeat calls Gateway API:**
   ```
   POST /api/alerts/heartbeat
   {
     "resourceId": "interactive-agent",
     "alertType": "heartbeat",
     "items": [...],
     "summary": "3 items need attention...",
     "suggestedActions": [...]
   }
   ```

2. **Gateway forwards to Agent:**
   ```
   POST /api/agents/interactive-agent/generate
   {
     "messages": [{"role": "user", "content": "## Heartbeat Alert..."}],
     "memory": {"resource": "default", "thread": "thread_interactive-agent_heartbeat"}
   }
   ```

3. **Agent Response:**
   ```json
   {
     "status": "delivered",
     "threadId": "thread_interactive-agent_heartbeat",
     "agentResponse": "I'll notify the user about these tasks..."
   }
   ```

### Step 3: Verify Alert Reached Agent

**Check Agent Thread:**
```bash
# Query the heartbeat thread for this agent
curl "http://localhost:4111/api/memory/threads/thread_interactive-agent_heartbeat/messages"
```

**Expected in Thread:**
```markdown
## Heartbeat Alert

**Summary:** 3 items need attention (1 high-priority, 1 medium, 1 low)

**Items requiring attention:**
🔴 [high] Critical: Complete quarterly report analysis
🟡 [medium] Blocked: Waiting for API credentials from DevOps
🟢 [low] 4 pending tasks in working memory

**Suggested actions:**
- Address high-priority task immediately
- Resolve blocker to unblock task
- Review and prioritize pending tasks

Please review these items and take appropriate action. You can:
- Send a message to the user
- Create tasks for follow-up
- Take automated action if appropriate
- Ignore if not critical
```

### Step 4: Verify Agent Decision (Not Automatic Delivery)

**Important:** The agent decides what to do, not the heartbeat.

**Possible Agent Actions:**
- **Notify user**: Send Slack/Telegram message
- **Create task**: Use TaskCreate tool for follow-up
- **Auto-archive**: Mark completed items
- **Ignore**: If user preferences say "don't interrupt"

**Verify in Logs:**
```
[AlertHandler] Agent responded: I'll send a summary to the user...
[AlertHandler] Thread: thread_interactive-agent_heartbeat
```

### Step 5: Test Deduplication

**Action:** Trigger heartbeat again immediately

```bash
curl -X POST http://localhost:3000/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{"resourceId": "default", "force": true}'
```

**Expected:** Same items delivered to agent again (agent decides suppression)

**Note:** Deduplication now happens at agent level based on user preferences, not heartbeat level.

### Step 6: Complete High-Priority Task

**Agent Action:** Mark critical task as complete

```markdown
# Working Memory

## Tasks
- [x] Critical: Complete quarterly report analysis
- [~] Blocked: Waiting for API credentials from DevOps
- [ ] Review PR #1234 from Sarah
- [ ] Update documentation for new feature
- [ ] Schedule team retro
- [ ] Prepare presentation slides
```

**Trigger:** Run heartbeat again

**Expected:** Alert sent to agent with only blocked task and pending tasks (high priority task gone)

### Step 7: Test Pause/Resume

**Action:** Pause heartbeat

```bash
curl -X POST http://localhost:3000/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{"action":"pause","reason":"Testing pause functionality"}'
```

**Trigger heartbeat (no force):**

**Expected:**
```json
{
  "success": true,
  "status": "HEARTBEAT_SKIPPED",
  "summary": "Heartbeat is paused"
}
```

**Action:** Resume heartbeat

```bash
curl -X POST http://localhost:3000/api/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{"action":"resume"}'
```

## Test Scenario: Error Handling

### Step 1: Agent Unreachable

**Simulate:** Stop the Mastra server

**Trigger:** Heartbeat check

**Expected:**
```json
{
  "success": false,
  "status": "HEARTBEAT_ERROR",
  "error": "Agent HTTP call failed: 500..."
}
```

**Verify:** Error logged, heartbeat continues running

### Step 2: Gateway Unreachable

**Simulate:** Stop Gateway server

**Expected:** Heartbeat step fails with connection error

## Test Scenario: Background Tasks

### Step 1: Register Background Task

**Agent Action:** Register a long-running task

```typescript
import { loadState, saveState, registerBackgroundTask } from './workflows/heartbeat';

let state = await loadState();
state = registerBackgroundTask(state, 'data-migration-001', 'Migrating user data to new schema');
await saveState(state);
```

**Note:** State is now stored in LibSQLStore, not JSON file.

### Step 2: Simulate Long Runtime

**Manual:** Wait 35+ minutes (or manipulate registeredAt timestamp in state)

### Step 3: Trigger Heartbeat

**Expected Alert to Agent:**
```json
{
  "type": "long-running-task",
  "description": "\"Migrating user data to new schema\" has been running for 35 minutes",
  "priority": "medium"
}
```

**Verify:** Agent receives alert and decides action

### Step 4: Mark Task Failed

```typescript
state = updateBackgroundTask(state, 'data-migration-001', {
  status: 'failed',
  error: 'Connection timeout to database'
});
await saveState(state);
```

**Expected Alert to Agent:**
```json
{
  "type": "failed-background-task",
  "description": "\"Migrating user data to new schema\" failed: Connection timeout to database",
  "priority": "high"
}
```

## Success Criteria

| Check | Expected | Actual |
|-------|----------|--------|
| Detect high priority | `[!]` task alerts | ⬜ |
| Detect blocked | `[~]` task alerts | ⬜ |
| Detect pending | 5+ `[ ]` tasks alert | ⬜ |
| HTTP API delivery | Alert sent to `/api/alerts/heartbeat` | ⬜ |
| Agent receives | Agent thread has alert message | ⬜ |
| Agent decides | Agent takes action (not auto-delivered) | ⬜ |
| Pause works | Skips when paused | ⬜ |
| Resume works | Runs after resume | ⬜ |
| Long-running task | >30min alerts | ⬜ |
| Failed task | Failed status alerts | ⬜ |
| Error handling | Graceful failure if agent unreachable | ⬜ |

## Cleanup

```bash
# Clear working memory tasks
# Reset heartbeat state in LibSQLStore
sqlite3 ./mastra-storage.db "DELETE FROM workflow_state WHERE key LIKE 'heartbeat%';"
```

Or programmatically:
```typescript
import { storage } from '../src/mastra/storage';

await storage.delete({
  tableName: 'workflow_state',
  key: 'heartbeat:state'
});
```

## Failure Modes

| Issue | Diagnostic |
|-------|------------|
| No items detected | Check working memory format, verify thread ID |
| No alert sent | Check gateway health, verify `/api/alerts/heartbeat` endpoint |
| Agent not receiving | Check agent HTTP endpoint, verify resourceId mapping |
| Pause ignored | Ensure not using force=true |
| State not persisted | Check LibSQLStore connection, verify table exists |

## Related Components

- `src/mastra/gateway/handlers/alert-handler.ts` - HTTP handler for alerts
- `src/mastra/gateway/routes/alerts.ts` - Express routes
- `src/mastra/workflows/heartbeat/clients/gateway-client.ts` - HTTP client
- `src/mastra/workflows/heartbeat/steps/deliver-alert.ts` - Delivery step
- `src/mastra/storage.ts` - LibSQLStore for state persistence

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Heartbeat Alert Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐      ┌──────────────────┐                 │
│  │  HeartbeatStep   │─────▶│  GatewayClient   │                 │
│  │  (detects tasks) │      │  (HTTP call)     │                 │
│  └──────────────────┘      └────────┬─────────┘                 │
│                                     │                            │
│                                     ▼                            │
│                           ┌──────────────────┐                  │
│                           │  POST /api/alerts │                  │
│                           │  /heartbeat       │                  │
│                           └────────┬─────────┘                  │
│                                    │                             │
│                                    ▼                             │
│                           ┌──────────────────┐                  │
│                           │  AlertHandler    │                  │
│                           │  (formats alert) │                  │
│                           └────────┬─────────┘                  │
│                                    │                             │
│                                    ▼                             │
│                           ┌──────────────────┐                  │
│                           │  POST /api/agents │                  │
│                           │  /{agent}/generate│                  │
│                           └────────┬─────────┘                  │
│                                    │                             │
│                                    ▼                             │
│                           ┌──────────────────┐                  │
│                           │  Interactive     │                  │
│                           │  Agent (decides) │                  │
│                           └────────┬─────────┘                  │
│                                    │                             │
│                     ┌──────────────┼──────────────┐             │
│                     ▼              ▼              ▼             │
│              ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│              │  Notify  │  │  Create  │  │  Ignore  │          │
│              │  User    │  │  Task    │  │          │          │
│              └──────────┘  └──────────┘  └──────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```
