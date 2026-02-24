# Service Test Suite

> Automated test scripts for Gateway services: Cron, Heartbeat, and Reflection

## Overview

This directory contains semantic test specifications for the three core services running within GatewayServer:

| Service | Purpose | Config Source |
|---------|---------|---------------|
| **SchedulerService** | Execute agent-defined CRON schedules | `CRON.md` |
| **HeartbeatService** | Monitor working memory, send alerts to agents via HTTP API | `agent.toml [heartbeat]` |
| **ReflectionService** | Aggregate patterns from conversation metadata | `agent.toml [reflection]` |

## Architecture Note

The **HeartbeatService** was refactored to use a gateway HTTP API architecture:

```
Before: Heartbeat → Channel Adapter → User
After:  Heartbeat → Gateway HTTP API → Agent → (decides) → User
```

The agent is now the central decision-maker for all heartbeat communications.

## Test Structure

Each test file follows the format:

```markdown
# Service Name Test

## Prerequisites
Required state and configuration

## Test Scenario: Human-readable description

### Step N: Action description
**Actor:** Who performs the action (Agent/System/User)
**Action:** What to do
**Expected:** Expected outcome

### Step N+1: ...

## Success Criteria
Checklist of verifiable outcomes

## Cleanup
Steps to restore clean state
```

## Running Tests

### Option 1: Manual Execution

Follow each step in the test files manually, checking off success criteria.

### Option 2: Semi-Automated (Agent-Assisted)

An agent can:
1. Read the test specification
2. Execute the "Agent Action" steps
3. Verify "Expected" outcomes
4. Report results

### Option 3: Automated (Future)

Tests can be converted to programmatic test cases:

```typescript
// Example: Convert heartbeat test to automated test
import { describe, test, expect } from 'bun:test';
import { HeartbeatService } from '../src/mastra/gateway/heartbeat';

describe('Heartbeat Service', () => {
  test('detects high priority tasks', async () => {
    // Implement test from heartbeat-test.md
  });
});
```

## Test Execution Order

**Recommended order:**

1. **cron-test.md** - Verify scheduler infrastructure
2. **heartbeat-test.md** - Test working memory monitoring with new HTTP API
3. **reflection-test.md** - Test pattern aggregation with LibSQLStore

Or run independently - no dependencies between tests.

## Common Setup

```bash
# Ensure gateway is running
curl http://localhost:3000/_gateway/health

# Verify services are active
curl http://localhost:3000/_gateway/status

# Verify agent is reachable
curl http://localhost:4111/api/agents/interactive-agent
```

## Test Data

Tests use isolated data:
- Cron: Creates/deletes test schedules in CRON.md
- Heartbeat: Uses dedicated thread ID (thread_test_heartbeat_*), state in LibSQLStore
- Reflection: Uses dedicated session ID (session:test-reflection-*), state in LibSQLStore

Tests clean up after themselves to avoid interference.

## State Persistence Changes

**Note:** State persistence moved from JSON files to LibSQLStore:

| Service | Before | After |
|---------|--------|-------|
| Heartbeat | `heartbeat-state.json` | LibSQLStore `workflow_state` table |
| Reflection | `reflection-state.json` | LibSQLStore `reflection_state` table |

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Service not responding | Gateway health endpoint |
| Changes not detected | Hot-reload interval (30s default) |
| No alerts delivered | Agent HTTP endpoint, verify `/api/alerts/heartbeat` |
| State not persisted | LibSQLStore connection, verify tables exist |
| Agent not receiving | Agent HTTP endpoint, check resourceId mapping |

## Extending Tests

To add a new test scenario:

1. Copy template from existing test
2. Define clear prerequisites
3. Use step format: `### Step N: Description`
4. Specify actor: `**Agent:**`, `**System:**`, or `**User:**`
5. Include expected outcomes
6. Add success criteria checklist
7. Provide cleanup steps

## Integration with CI/CD

These semantic tests can be:
- Parsed by a test runner
- Converted to executable test cases
- Used for manual QA validation
- Referenced in documentation

## Service Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        GatewayServer                             │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────────────────┐│
│  │  SchedulerService   │    │      HeartbeatService           ││
│  │  ─────────────────  │    │      ─────────────────          ││
│  │  • CRON.md          │    │  • Working memory checks        ││
│  │  • Agent schedules  │    │  • Alerts via HTTP API          ││
│  └─────────────────────┘    │  • Agent decision-making        ││
│                             └─────────────────────────────────┘│
│                                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                ReflectionService                             ││
│  │  • Pattern aggregation from reflector metadata              ││
│  │  • Writes to REFLECTIONS.md                                 ││
│  │  • State in LibSQLStore                                     ││
│  └─────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

## Heartbeat Alert Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  HeartbeatStep  │────▶│  GatewayClient  │────▶│   POST /api/    │
│  (detect tasks) │     │  (HTTP call)    │     │  alerts/heartbeat│
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │  AlertHandler   │
                                               │  (format alert) │
                                               └────────┬────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  POST /api/     │
                                               │  agents/{id}/   │
                                               │  generate       │
                                               └────────┬────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  Interactive    │
                                               │  Agent (decides)│
                                               └─────────────────┘
```

## Related Files

| File | Purpose |
|------|---------|
| `cron-test.md` | CRON.md schedule lifecycle tests |
| `heartbeat-test.md` | Working memory task detection with HTTP API |
| `reflection-test.md` | Pattern aggregation with LibSQLStore |
| `../../src/mastra/gateway/scheduler/service.ts` | Scheduler implementation |
| `../../src/mastra/gateway/handlers/alert-handler.ts` | Alert HTTP handler |
| `../../src/mastra/workflows/reflection/` | Reflection workflow |
| `../../src/mastra/storage.ts` | LibSQLStore for state persistence |
