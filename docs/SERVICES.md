# Gateway Services

Overview of the in-process services that run within the GatewayServer and the reflection workflow.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GatewayServer                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │   CronService      │    │      HeartbeatService           │ │
│  │   ─────────────     │    │      ─────────────────          │ │
│  │  • CRON.md only     │    │  • Working memory checks        │ │
│  │  • Agent-defined    │    │  • Background tasks             │ │
│  │    schedules        │    │  • Proactive alerts             │ │
│  │                     │    │                                 │ │
│  └─────────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Reflection Workflow                             │
│  • Mastra workflow (not a gateway service)                       │
│  • Scans conversations → LLM analysis → REFLECTIONS.md          │
│  • Triggered via HTTP API or as agent tool                      │
└─────────────────────────────────────────────────────────────────┘
```

## Service Comparison

| Aspect | CronService | HeartbeatService | Reflection Workflow |
|--------|--------------|------------------|---------------------|
| **Purpose** | Agent-defined cron schedules | Working memory monitoring | Pattern learning |
| **Config Section** | `[cron]` | `[heartbeat]` | `[attention_steering]` |
| **Schedule Source** | `CRON.md` | `agent.toml` | `agent.toml` / on-demand |
| **Managed By** | Agent (via tools) | System | Agent (tool) or HTTP API |
| **Output** | Channel messages | Alert to agent | REFLECTIONS.md |
| **Runtime** | In-process (gateway) | In-process (gateway) | Mastra workflow |

## CronService

Manages agent-derived schedules from `CRON.md`.

### Configuration

```toml
[cron]
cron_md_path = "CRON.md"
poll_interval_seconds = 30
thread_ttl_days = 7
cleanup_interval_ms = 3600000
```

### Features
- **Hot reload**: Detects CRON.md changes automatically
- **Session modes**: Shared (persistent context) or Isolated (fresh per run)
- **Agent-managed**: Agent creates/updates/deletes via `cron-manage` tool

### Example CRON.md

```markdown
## Daily Report

- **Schedule**: `0 9 * * *`
- **Message**: "Generate daily summary"
- **Target**: slack
- **Session Mode**: shared
```

See [CRON_SESSION_MANAGEMENT.md](CRON_SESSION_MANAGEMENT.md) for details.

## HeartbeatService

Proactive notification system for monitoring tasks and working memory.

### Configuration

```toml
[heartbeat]
alert_threshold = 1

[heartbeat.hours]
start = 9
end = 21
timezone = "Asia/Bangkok"
interval_minutes = 30

[heartbeat.checks]
task_state = true
background_tasks = true
```

### What It Monitors
- **Working Memory**: `- [!]` high priority, `- [~]` blocked, `- [ ]` pending tasks
- **Background Tasks**: Failed, long-running (>30min), pending (>15min)

### Alert Flow
1. Check active hours
2. Load state (with pause check)
3. Scan working memory
4. Check background tasks
5. Deduplicate (24h suppression)
6. Deliver alert to agent via HTTP

See [HEARTBEAT_SYSTEM.md](HEARTBEAT_SYSTEM.md) for details.

## Reflection Workflow

Analyzes past conversations to extract patterns. Implemented as a Mastra workflow (not a gateway service).

### Configuration

```toml
[attention_steering]
enable_reflections = true
cron_schedule = "*/5 * * * *"
max_messages_per_run = 1000
min_batch_size = 10
max_pending_minutes = 30
reflections_md_path = "REFLECTIONS.md"
reflection_state_path = "reflection-state.json"
```

### Pipeline
1. **Collect** — Scan memory threads for unprocessed user/assistant pairs
2. **Analyze** — Call reflector agent (LLM) with existing patterns as context
3. **Aggregate** — Merge new patterns with existing REFLECTIONS.md

### Pattern Types
- **Attention Signals**: Important patterns to remember
- **Noise Patterns**: Things to filter out
- **Decision Markers**: User preferences and decisions

### Trigger

```bash
# Via HTTP
curl -X POST http://localhost:4111/api/workflows/reflection/start-async \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"resourceId": "interactive-agent"}}'
```

See [REFLECTION_SYSTEM.md](REFLECTION_SYSTEM.md) for details.

## Adaptation Pipeline

The Adaptation System extends the reflection workflow with a three-stage pipeline: **Observe → Reflect → Coach**. It extracts observations from conversations, synthesizes them into patterns, and generates coaching suggestions delivered inline during future conversations.

### Configuration

```toml
[adaptation]
enabled = true
coaching_enabled = true
coaching_max_pending = 5
```

See [ADAPTATION_SYSTEM.md](ADAPTATION_SYSTEM.md) for details.

## Configuration Consistency

All services follow the same configuration pattern:

| Service | Config File | Section | Enable Toggle |
|---------|-------------|---------|---------------|
| Cron | `agent.toml` | `[cron]` | `[services].cron = true/false` |
| Heartbeat | `agent.toml` | `[heartbeat]` | `[services].heartbeat = true/false` |
| Reflection | `agent.toml` | `[attention_steering]` | `[services].reflection = true/false` |

## Lifecycle

Gateway services follow the same lifecycle within GatewayServer:

1. **Start** (in order):
   ```
   GatewayServer.start()
     → HeartbeatService.start()
     → CronService.start()
   ```

2. **Stop** (reverse order):
   ```
   GatewayServer.stop()
     → HeartbeatService.stop()
     → CronService.stop()
   ```

The reflection workflow runs independently via Mastra's workflow engine.

## Programmatic Access

```typescript
import { getGatewayInstance } from './gateway/integration';

const gateway = getGatewayInstance();

// Access gateway services
const cron = gateway?.getCronService();
const heartbeat = gateway?.getHeartbeatService();

// Check status
console.log(cron?.isRunning());
console.log(heartbeat?.isActive());

// Reflection workflow is triggered via Mastra HTTP API
// POST /api/workflows/reflection/start-async
```

## Testing

Each service/workflow has semantic test specifications:

| Service | Test File |
|---------|-----------|
| Cron | [tests/services/cron-test.md](../tests/services/cron-test.md) |
| Heartbeat | [tests/services/heartbeat-test.md](../tests/services/heartbeat-test.md) |
| Reflection | [tests/services/reflection-test.md](../tests/services/reflection-test.md) |

## Migration History

### Legacy Scheduler → Gateway Services (2025)

The old `SchedulerService` was split into `CronService` + `HeartbeatService`.

### ReflectionService → Reflection Workflow (2026-02)

The in-process `ReflectionService` (cron gateway service) and `ReflectorProcessor` (output processor) were replaced by a Mastra workflow that scans conversations directly and calls the reflector agent in batches. See [REFLECTION_SYSTEM.md](REFLECTION_SYSTEM.md) for migration notes.
