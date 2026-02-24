# Agent Configuration Guide

This document describes the agent configuration system. All settings are centralized in `agent.toml`, which serves as the single source of truth for agent behavior.

## The `.agent/` Directory

All agent configuration, identity, and runtime state live in a single `.agent/` directory at the project root. This cleanly separates the agent workspace from source code.

```
.agent/
  agent.toml              # Main configuration (required)
  IDENTITY.md             # Agent identity & voice
  SOUL.md                 # Personality & values
  USER.md                 # User context
  HEARTBEAT.md            # Heartbeat description
  CRON.md                 # Scheduled tasks
  REFLECTIONS.md          # Reflection patterns (auto-generated)
  heartbeat-state.json    # Runtime state (gitignored)
  reflection-state.json   # Runtime state (gitignored)
  skills/                 # Skill definitions
```

The `AGENT_DIR` constant (exported from `src/mastra/lib/config`) resolves to this directory. Override it with the `AGENT_DIR` environment variable for custom layouts.

Relative paths in `agent.toml` (e.g. `reflections_md_path = "REFLECTIONS.md"`) are resolved relative to `agent.toml`'s directory via `resolveConfigPath()`, so they automatically point into `.agent/`.

### Config File Search Order

1. `.agent/agent.toml` (primary)
2. `./agent.toml` (root fallback)

The first file found is used. If no configuration file exists, the agent will fail to start.

## Configuration Sections

### Identity

Defines the agent's core identity.

```toml
[identity]
name = "Scion"
role = "AI Assistant"
purpose = "Help users with software engineering, code analysis, and general tasks"
```

| Setting | Type | Description |
|---------|------|-------------|
| `name` | string | The agent's name |
| `role` | string | The agent's role description |
| `purpose` | string | The agent's purpose statement |

### Archetype

Defines the agent's personality archetype.

```toml
[archetype]
type = "sage"
```

| Setting | Type | Description |
|---------|------|-------------|
| `type` | string | Personality archetype (e.g., "sage", "helper", "creator") |

### Soul (Personality Traits)

Big Five personality traits on a 0-1 scale.

```toml
[soul]
openness = 0.8
conscientiousness = 0.7
extraversion = 0.4
agreeableness = 0.6
neuroticism = 0.3
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `openness` | float (0-1) | - | Creativity and willingness to try new things |
| `conscientiousness` | float (0-1) | - | Organization and dependability |
| `extraversion` | float (0-1) | - | Sociability and talkativeness |
| `agreeableness` | float (0-1) | - | Cooperativeness and empathy |
| `neuroticism` | float (0-1) | - | Emotional sensitivity |

### Loop

Controls the agent's execution loop behavior.

```toml
[loop]
pattern = "kimi-loop"
max_iterations = 3
max_steps_per_turn = 50
max_retries_per_step = 3
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pattern` | string | "kimi-loop" | Loop pattern (task-based, ralph-loop, agent-swarm, agent-team, kimi-loop) |
| `max_iterations` | int | 3 | Maximum loop iterations (0 = disabled, -1 = unlimited) |
| `max_steps_per_turn` | int | 50 | Maximum tool calls per turn |
| `max_retries_per_step` | int | 3 | Maximum retries for failed tool calls |

### Models

Model configuration for LLM providers.

```toml
[models]
default = "glm-4.7"

[models.z]
baseUrl = "https://api.z.ai/api/coding/paas/v4"
# apiKey should be set via environment variable: ZHIPU_API_KEY
```

| Setting | Type | Description |
|---------|------|-------------|
| `default` | string | Default model identifier |
| `[models.<provider>]` | object | Provider-specific configuration |

### Memory

Controls how the agent manages conversation memory.

```toml
[memory]
last_messages = 10
semantic_recall_top_k = 3
semantic_recall_message_range = 2
semantic_recall_scope = "resource"
working_memory_enabled = true
working_memory_scope = "thread"
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `last_messages` | int | 10 | Number of recent messages to include in context |
| `semantic_recall_top_k` | int | 3 | Number of semantically similar messages to retrieve |
| `semantic_recall_message_range` | int | 2 | Messages before/after each semantic match to include |
| `semantic_recall_scope` | "resource" \| "thread" | "resource" | Scope for semantic search ("resource" = all threads, "thread" = current only) |
| `working_memory_enabled` | bool | true | Enable working memory for task state |
| `working_memory_scope` | "resource" \| "thread" | "thread" | Scope for working memory |

### Server

HTTP server configuration.

```toml
[server]
timeout = 600000
host = "0.0.0.0"
port = 4111
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `timeout` | int | 600000 | Request timeout in milliseconds (default: 10 minutes) |
| `host` | string | "0.0.0.0" | Server bind address |
| `port` | int | 4111 | Server port |

### Services

Controls which background services are enabled.

```toml
[services]
cron = true
heartbeat = true
reflection = true
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `cron` | bool | true | Enable the CronService |
| `heartbeat` | bool | true | Enable the HeartbeatService |
| `reflection` | bool | true | Enable the Reflection workflow |

### Cron

Manages agent-defined CRON schedules from `CRON.md`.

```toml
[cron]
cron_md_path = "CRON.md"
poll_interval_seconds = 30
thread_ttl_days = 7
cleanup_interval_ms = 3600000
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `cron_md_path` | string | "CRON.md" | Path to CRON.md file (relative to agent.toml) |
| `poll_interval_seconds` | int | 30 | How often to check CRON.md for changes (seconds) |
| `thread_ttl_days` | int | 7 | Days before isolated session threads are cleaned up |
| `cleanup_interval_ms` | int | 3600000 | How often to run thread cleanup (ms) |

**Note:** Enable/disable via `[services].cron`. CronService only processes schedules from `CRON.md`. For system-level scheduled tasks, see Heartbeat and Attention Steering sections below.

### Heartbeat

Automated health check and notification system. The heartbeat schedule is fully configured here (not in CRON.md).

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

[[heartbeat.targets]]
type = "slack"
target = "#general"
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `quiet_mode` | bool | false | Suppress non-critical notifications |
| `alert_threshold` | int | 1 | Minimum severity level to trigger alerts |
| `hours.start` | int (0-23) | 9 | Active hours start (local time) |
| `hours.end` | int (0-23) | 21 | Active hours end (local time) |
| `hours.timezone` | string | "UTC" | Timezone for active hours |
| `hours.interval_minutes` | int | 30 | How often to run heartbeat (minutes) |
| `checks.*` | bool | true | Individual check toggles |
| `targets[].type` | "slack" \| "telegram" \| "discord" | - | Notification channel type |
| `targets[].target` | string | - | Channel/chat ID to notify |

The heartbeat generates a cron schedule automatically: `*/{interval_minutes} {start}-{end} * * *` in the configured timezone.

### Attention Steering

Analyzes past conversations to extract patterns. Runs as a Mastra workflow.

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

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enable_reflections` | bool | true | Enable reflection workflow (pattern extraction) |
| `cron_schedule` | string | "*/5 * * * *" | Cron expression for automated runs |
| `max_messages_per_run` | int | 1000 | Maximum messages to scan per run |
| `min_batch_size` | int | 10 | Minimum new messages before processing |
| `max_pending_minutes` | int | 30 | Force run after this staleness (minutes) |
| `reflections_md_path` | string | "REFLECTIONS.md" | Output file path (relative to agent.toml) |
| `reflection_state_path` | string | "reflection-state.json" | State file path (relative to agent.toml) |

## Programmatic Access

Configuration can be accessed programmatically using helper functions:

```typescript
import {
  AGENT_DIR,
  loadAgentConfig,
  getMemoryConfig,
  getServerConfig,
  getLoopConfig,
  getHeartbeatConfig,
  getCronConfig,
  getAttentionSteeringConfig,
  resolveConfigPath,
} from './src/mastra/lib/config';

// Load full config
const config = await loadAgentConfig();

// Load specific sections with defaults
const memory = await getMemoryConfig();
const server = await getServerConfig();
const cron = await getCronConfig();
const attentionSteering = await getAttentionSteeringConfig();
const loop = await getLoopConfig();
const heartbeat = await getHeartbeatConfig();

// Resolve a path relative to agent.toml's directory
const cronMdPath = resolveConfigPath(cron.cron_md_path);

// Use AGENT_DIR directly for files that live alongside agent.toml
import { join } from 'path';
const statePath = join(AGENT_DIR, 'heartbeat-state.json');
```

### Caching

Configuration is cached after first load for performance. To force a reload:

```typescript
import { clearConfigCache, loadAgentConfig } from './src/mastra/lib/config';

clearConfigCache();
const freshConfig = await loadAgentConfig();
```

## Example: Complete Configuration

```toml
# Agent Configuration
# Located at .agent/agent.toml

[identity]
name = "Scion"
role = "AI Assistant"
purpose = "Help users with software engineering, code analysis, and general tasks"

[archetype]
type = "sage"

[soul]
openness = 0.8
conscientiousness = 0.7
extraversion = 0.4
agreeableness = 0.6
neuroticism = 0.3

[loop]
pattern = "kimi-loop"
max_iterations = 3
max_steps_per_turn = 50
max_retries_per_step = 3

[models]
default = "glm-4.7"

[memory]
last_messages = 10
semantic_recall_top_k = 3
semantic_recall_message_range = 2
semantic_recall_scope = "resource"
working_memory_enabled = true
working_memory_scope = "thread"

[server]
timeout = 600000
host = "0.0.0.0"
port = 4111

# Background services toggle
[services]
cron = true
heartbeat = true
reflection = true

# Cron Service - Agent-defined CRON schedules
[cron]
cron_md_path = "CRON.md"
poll_interval_seconds = 30
thread_ttl_days = 7
cleanup_interval_ms = 3600000

# Heartbeat Service - Proactive working memory monitoring
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

[[heartbeat.targets]]
type = "slack"
target = "#general"

# Attention Steering - Pattern extraction from conversations
[attention_steering]
enable_reflections = true
cron_schedule = "*/5 * * * *"
max_messages_per_run = 1000
min_batch_size = 10
max_pending_minutes = 30
reflections_md_path = "REFLECTIONS.md"
reflection_state_path = "reflection-state.json"
```

## Defaults

All configuration sections have sensible defaults. If a section or setting is omitted, the default value is used. This means you only need to specify values you want to change from the defaults.

For example, a minimal configuration could be:

```toml
[identity]
name = "MyAgent"

[models]
default = "gpt-4"
```

All other settings will use their default values.
