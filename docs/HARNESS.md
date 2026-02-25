# Mastra Harness Architecture

The Harness is an orchestration layer between the gateway and Mastra agents. It provides a single point of control for:

- **Mode-based model selection** — Switch between different agent configurations
- **Tool permission system** — YOLO mode, per-category, and per-tool approval policies
- **Observational Memory (OM)** — Dynamic model resolution and threshold configuration
- **Event streaming** — Real-time updates for tool approvals, message streaming, etc.

## Why Harness?

Previously, the gateway called agents directly via `/api/agents/interactiveAgent/generate`. This caused:

1. **Memory leaks** — MCP tools leaked memory when multiple Mastra instances were created
2. **No centralized state** — Each request was independent, no shared state across channels
3. **Limited control** — No way to configure OM models or tool permissions at runtime

The Harness solves these by providing a **singleton instance** that all gateway requests flow through.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Mastra Server                                  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Harness Manager (singleton)                      │   │
│  │                                                                       │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │   │
│  │  │  Harness State  │  │  Mode Manager   │  │  Event Subscriptions│  │   │
│  │  │  - yolo         │  │  - default      │  │  - per-thread       │  │   │
│  │  │  - permissions  │  │  - fast         │  │  - SSE delivery     │  │   │
│  │  │  - OM config    │  │  - (custom)     │  │                     │  │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │   │
│  │                                                                       │   │
│  │  ┌───────────────────────────────────────────────────────────────┐   │   │
│  │  │              Dynamic Memory Factory                            │   │   │
│  │  │  - Reads OM config from harness state                         │   │   │
│  │  │  - Creates Memory instance per-request with requestContext    │   │   │
│  │  │  - Caches Memory when config unchanged                        │   │   │
│  │  └───────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       Harness HTTP Routes                            │   │
│  │  /_harness/init          /_harness/sendMessage                      │   │
│  │  /_harness/status        /_harness/events/:threadId                 │   │
│  │  /_harness/state         /_harness/toolApproval                     │   │
│  │  /_harness/modes/*       /_harness/models/*                         │   │
│  │  /_harness/threads/*     /_harness/abort  /_harness/steer           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ HTTP
                                      │
┌─────────────────────────────────────┴───────────────────────────────────────┐
│                           Gateway Adapter                                   │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │ Telegram Channel│  │ Slack Channel   │  │ Other Channels...           │ │
│  └────────┬────────┘  └────────┬────────┘  └──────────────┬──────────────┘ │
│           │                    │                          │                 │
│           └────────────────────┴──────────────────────────┘                 │
│                                │                                            │
│                    callHarnessViaHttp()                                     │
│                    initHarness()                                            │
│                    getHarnessStatus()                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Harness Manager (`harness-manager.ts`)

Manages the singleton harness instance:

```typescript
// Get or create the singleton harness
const harness = await getHarness();

// Check if harness is ready
if (isHarnessInitialized()) {
  // harness is available
}

// Subscribe to events for a thread
const unsubscribe = subscribeToThread(threadId, (event) => {
  console.log(event.type, event.data);
});
```

### 2. Harness Factory (`harness.ts`)

Creates the harness with all configuration from `agent.toml`:

```typescript
export async function createAgentHarness(config?: AgentHarnessConfig) {
  // Load config from agent.toml
  const agentConfig = await loadAgentConfig();
  const memoryConfig = await getMemoryConfig();

  // Create dynamic memory factory
  const dynamicMemory = createDynamicMemory({
    omModel: memoryConfig.om_model,
    obsThreshold: memoryConfig.om_observation_threshold,
    refThreshold: memoryConfig.om_reflection_threshold,
    // ...
  });

  // Create harness
  const harness = new Harness({
    id: "multi-channel-agent",
    storage,
    memory: dynamicMemory,
    stateSchema,
    modes,
    resolveModel,
    toolCategoryResolver,
  });

  return { harness };
}
```

### 3. Dynamic Memory Factory

The harness uses a dynamic memory factory that reads OM config from harness state:

```typescript
function createDynamicMemory(defaults) {
  return ({ requestContext }) => {
    // Read current config from harness state
    const state = getHarnessState(requestContext);

    // Use state values, fallback to defaults
    const obsThreshold = state?.observationThreshold ?? defaults.obsThreshold;
    const refThreshold = state?.reflectionThreshold ?? defaults.refThreshold;

    // Create memory with OM enabled
    return new Memory({
      options: {
        observationalMemory: {
          enabled: true,
          observation: {
            model: (ctx) => getObserverModel(ctx, defaults),
            messageTokens: obsThreshold,
          },
          reflection: {
            model: (ctx) => getReflectorModel(ctx, defaults),
            observationTokens: refThreshold,
          },
        },
      },
    });
  };
}
```

### 4. Harness State Schema

The harness state includes all runtime configuration:

```typescript
export const stateSchema = z.object({
  currentModelId: z.string().default(""),
  projectPath: z.string().optional(),
  channelType: z.string().optional(),
  channelId: z.string().optional(),

  // YOLO mode — auto-approve all tool calls
  yolo: z.boolean().default(false),

  // Permission rules — per-category and per-tool approval policies
  permissionRules: z.object({
    categories: z.record(z.enum(["allow", "ask", "deny"])).default({}),
    tools: z.record(z.enum(["allow", "ask", "deny"])).default({}),
  }),

  // Observational Memory settings (runtime override)
  observerModelId: z.string().optional(),
  reflectorModelId: z.string().optional(),
  observationThreshold: z.number().optional(),
  reflectionThreshold: z.number().optional(),
});
```

## HTTP API Reference

### Initialization

#### `POST /_harness/init`

Initialize the harness singleton. Safe to call multiple times.

**Response:**
```json
{
  "success": true,
  "currentModeId": "default",
  "currentModelId": "zai-coding-plan/glm-5",
  "resourceId": "interactive-agent"
}
```

#### `GET /_harness/status`

Get current harness status.

**Response:**
```json
{
  "initialized": true,
  "currentModeId": "default",
  "currentModelId": "zai-coding-plan/glm-5",
  "currentThreadId": "thread_telegram_12345",
  "resourceId": "interactive-agent",
  "isRunning": false,
  "tokenUsage": {
    "promptTokens": 1500,
    "completionTokens": 500,
    "totalTokens": 2000
  }
}
```

### Message Handling

#### `POST /_harness/sendMessage`

Send a message through the harness.

**Request:**
```json
{
  "content": "Hello, how are you?",
  "channelType": "telegram",
  "channelId": "12345",
  "threadId": "optional-thread-id",
  "images": [
    { "data": "base64...", "mimeType": "image/png" }
  ]
}
```

**Response:**
```json
{
  "text": "I'm doing well! How can I help you today?",
  "threadId": "thread_telegram_12345"
}
```

#### `GET /_harness/events/:threadId`

SSE stream for harness events.

**Events:**
```
event: message_start
data: {"type":"message_start","message":{...}}

event: message_update
data: {"type":"message_update","message":{...}}

event: tool_approval_required
data: {"type":"tool_approval_required","toolName":"bash","args":{...}}

event: agent_end
data: {"type":"agent_end","reason":"complete"}
```

### State Management

#### `GET /_harness/state`

Get current harness state.

#### `PATCH /_harness/state`

Update harness state.

**Request:**
```json
{
  "yolo": true,
  "observerModelId": "google/gemini-2.5-flash",
  "observationThreshold": 50000
}
```

### Tool Approval

#### `POST /_harness/toolApproval`

Respond to a pending tool approval.

**Request:**
```json
{
  "decision": "approve",
  "threadId": "thread_telegram_12345"
}
```

Decisions:
- `approve` — Allow this tool call
- `decline` — Deny this tool call
- `always_allow_category` — Allow all tools in this category for the session

### Mode & Model Management

#### `GET /_harness/modes`

List available modes.

**Response:**
```json
{
  "currentModeId": "default",
  "modes": [
    { "id": "default", "name": "Default", "default": true, "defaultModelId": "zai-coding-plan/glm-5" },
    { "id": "fast", "name": "Fast", "defaultModelId": "google/gemini-2.5-flash" }
  ]
}
```

#### `POST /_harness/modes/switch`

Switch to a different mode.

**Request:**
```json
{ "modeId": "fast" }
```

#### `GET /_harness/models`

List available models with auth status.

#### `POST /_harness/models/switch`

Switch to a different model.

**Request:**
```json
{
  "modelId": "anthropic/claude-sonnet-4",
  "scope": "global"
}
```

### Thread Management

#### `GET /_harness/threads`

List all threads.

#### `POST /_harness/threads/switch`

Switch to a specific thread.

#### `POST /_harness/threads/create`

Create a new thread.

#### `GET /_harness/threads/messages`

Get messages for the current thread.

### Control Operations

#### `POST /_harness/abort`

Abort the current operation.

#### `POST /_harness/steer`

Steer the agent mid-stream (abort current and send new message).

**Request:**
```json
{ "content": "Actually, let's do something different..." }
```

## Configuration

All harness defaults come from `agent.toml`:

```toml
[models]
default = "zai-coding-plan/glm-5"
fast = "google/gemini-2.5-flash"

[memory]
last_messages = 30
semantic_recall_top_k = 5
semantic_recall_message_range = 10
semantic_recall_scope = "resource"
om_model = "google/gemini-2.5-flash"
om_observation_threshold = 50000
om_reflection_threshold = 60000

[security]
resource_id = "interactive-agent"
```

## Gateway Integration

The gateway adapter uses the harness via HTTP:

```typescript
class GatewayToMastraAdapter {
  // Initialize harness at startup
  async initHarness() {
    const response = await fetch(`${this.mastraUrl}/_harness/init`, {
      method: "POST",
      headers: this.authHeaders,
    });
    // ...
  }

  // Process messages through harness
  async callHarnessViaHttp(message, channelContext) {
    const response = await fetch(`${this.mastraUrl}/_harness/sendMessage`, {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({
        content: message,
        channelType: channelContext.channelType,
        channelId: channelContext.channelId,
        threadId: channelContext.threadId,
      }),
    });
    return response.json();
  }
}
```

## Event Types

The harness emits events for UI updates:

| Event | Description |
|-------|-------------|
| `message_start` | Agent started generating a message |
| `message_update` | Message content updated (streaming) |
| `message_end` | Message generation complete |
| `tool_start` | Tool execution started |
| `tool_approval_required` | Tool needs approval |
| `tool_end` | Tool execution complete |
| `agent_start` | Agent started processing |
| `agent_end` | Agent finished processing |
| `state_changed` | Harness state updated |
| `error` | An error occurred |
| `om_status` | Observational Memory status update |
| `om_observation_start` | OM observation started |
| `om_observation_end` | OM observation complete |

## Memory Architecture

The harness uses a two-tier memory system:

1. **Shared Memory** (`memory.ts`) — Static Memory instance with OM disabled
   - Used by tools and agents that don't have harness context
   - Same storage backend as harness

2. **Dynamic Memory** (harness) — Created per-request with OM enabled
   - Reads OM config from harness state via `requestContext`
   - Allows runtime switching of OM models and thresholds
   - Caches Memory instance when config unchanged

```typescript
// Shared memory (OM disabled)
export const sharedMemory = new Memory({
  options: {
    observationalMemory: { enabled: false },
  },
});

// Dynamic memory (OM enabled, created per-request)
const dynamicMemory = createDynamicMemory({...});
const harness = new Harness({
  memory: dynamicMemory,
  // ...
});
```

## Related Documentation

- [API_ROUTE_MAP.md](API_ROUTE_MAP.md) — Complete API route reference
- [MEMORY_SYSTEM.md](MEMORY_SYSTEM.md) — Memory architecture
- [CONFIGURATION.md](CONFIGURATION.md) — agent.toml configuration
