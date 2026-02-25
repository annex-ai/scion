# Memory System Architecture

This document provides comprehensive documentation of the adapted memory system used in this agent platform. The architecture implements a multi-layer, multi-scope memory design that enables personalization, continuity, and context-aware interactions.

## Table of Contents

1. [Overview](#overview)
2. [Memory Layers](#memory-layers)
3. [Memory Scopes](#memory-scopes)
4. [Soul System Integration](#soul-system-integration)
5. [Session Management](#session-management)
6. [Input Processors Pipeline](#input-processors-pipeline)
7. [Storage Architecture](#storage-architecture)
8. [Scheduler Memory Modes](#scheduler-memory-modes)
9. [Configuration Reference](#configuration-reference)
10. [Best Practices](#best-practices)

---

## Overview

The memory system is built on top of Mastra's Memory primitive, extended with custom processors and the Soul System. It provides:

- **Four-layer memory architecture** for different temporal contexts
- **Multi-scope isolation** (thread vs. resource)
- **Personality persistence** via Soul configuration files
- **Learned user preferences** that persist across all conversations
- **Semantic recall** across conversation history
- **Deterministic sessions** that survive server restarts

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         MEMORY SYSTEM ARCHITECTURE                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    INPUT PROCESSORS PIPELINE                     │    │
│  │                                                                  │    │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │    │
│  │  │ Soul Loader  │ → │    User      │ → │   Unicode    │        │    │
│  │  │  Processor   │   │ Preferences  │   │  Normalizer  │        │    │
│  │  └──────────────┘   └──────────────┘   └──────────────┘        │    │
│  │         ↓                  ↓                  ↓                 │    │
│  │  ┌──────────────┐                                               │    │
│  │  │    Skills    │                                               │    │
│  │  │  Processor   │                                               │    │
│  │  └──────────────┘                                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    MEMORY LAYERS                                 │    │
│  │                                                                  │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │ Layer 1: Recent Messages (lastMessages: 10)              │   │    │
│  │  │ ├─ Immediate conversation context                        │   │    │
│  │  │ └─ Always available, no embedding cost                   │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │ Layer 2: Working Memory (scope: "thread")                │   │    │
│  │  │ ├─ Task state, progress tracking                         │   │    │
│  │  │ ├─ Isolated per conversation                             │   │    │
│  │  │ └─ Agent-managed structured data                         │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │ Layer 3: Semantic Recall (scope: "resource")             │   │    │
│  │  │ ├─ Vector similarity search (FastEmbed)                  │   │    │
│  │  │ ├─ TopK: 3 most relevant messages                        │   │    │
│  │  │ ├─ MessageRange: 2 surrounding messages                  │   │    │
│  │  │ └─ Searches ALL conversations for this user              │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  │                                                                  │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │ Layer 4: Observational Memory (scope: "resource")        │   │    │
│  │  │ ├─ Automatic observation at token threshold (50k)        │   │    │
│  │  │ ├─ Reflection pass at observation threshold (60k)        │   │    │
│  │  │ ├─ Resource-scoped: spans all threads for the user       │   │    │
│  │  │ └─ Model: configured via om_model in agent.toml         │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    STORAGE BACKEND                               │    │
│  │                                                                  │    │
│  │  ┌───────────────┐         ┌───────────────┐                    │    │
│  │  │  LibSQLStore  │         │ LibSQLVector  │                    │    │
│  │  │  (Relational) │         │ (Embeddings)  │                    │    │
│  │  └───────────────┘         └───────────────┘                    │    │
│  │           │                        │                             │    │
│  │           └────────┬───────────────┘                             │    │
│  │                    ▼                                             │    │
│  │            ┌───────────────┐                                     │    │
│  │            │    SQLite     │                                     │    │
│  │            │ (file:./db)   │                                     │    │
│  │            └───────────────┘                                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Memory Layers

### Layer 1: Recent Messages

The most basic memory layer - keeps the last N messages from the current conversation.

```typescript
options: {
  lastMessages: 10,  // Keep last 10 messages
}
```

**Characteristics:**
- No embedding or search cost
- Always available in context
- Provides immediate conversation continuity
- Configurable count (default: 10)

**Use cases:**
- Following up on recent questions
- Maintaining conversation flow
- Reference to recently discussed items

### Layer 2: Working Memory (Thread-Scoped)

Structured memory for tracking task state within a single conversation.

```typescript
options: {
  workingMemory: {
    enabled: true,
    scope: "thread",  // Per-conversation isolation
  },
}
```

**Characteristics:**
- Isolated to current conversation thread
- Persisted to storage, survives reconnection
- Agent-managed (can read/write)
- Structured data (task queue, progress, notes)

**Working Memory Schema:**

```markdown
# Ralph Loop State

## Goal:
[Current objective]

## Session Info
- **Started At**: [timestamp]
- **Current Iteration**: [n]
- **Max Iterations**: [limit]
- **Status**: [in_progress|complete]

## Original Request:
[User's initial request]

## Task Queue:

### Current Focus:
[Active task]

### Pending Tasks:
- Task 1
- Task 2

### Completed Tasks:
- [x] Task A
- [x] Task B

## Progress Log:
- [timestamp] Completed X
- [timestamp] Started Y

## Notes & Context:
[Important context, blockers, decisions]
```

**Use cases:**
- Multi-step task orchestration
- Progress tracking
- State persistence across agent iterations

### Layer 3: Semantic Recall (Resource-Scoped)

Vector similarity search across all conversations for the user.

```typescript
options: {
  semanticRecall: {
    topK: 3,           // Retrieve 3 most similar
    messageRange: 2,   // Include 2 surrounding messages
    scope: "resource", // Search across all threads
  },
}
```

**Characteristics:**
- Uses FastEmbed for vector embeddings
- Searches ALL conversations for this user (resource)
- Returns contextually relevant past information
- Includes surrounding messages for context

**Use cases:**
- Remembering past decisions
- Recalling previous project discussions
- Cross-conversation context ("as we discussed before...")

### Layer 4: Observational Memory (Resource-Scoped)

Automatic long-context memory management that replaces manual compaction. OM runs two passes — observation (extracts key facts, decisions, and patterns) and reflection (synthesizes observations into durable memory) — triggered by token thresholds.

```toml
# agent.toml [memory] section
om_mode = "static"                # agent-level memory (works everywhere)
om_model = "google/gemini-2.5-flash"
om_scope = "resource"             # cross-thread (default for always-on agents)
om_observation_threshold = 50000  # tokens before observation pass
om_reflection_threshold = 60000   # tokens before reflection pass
```

**Characteristics:**
- Resource-scoped by default — observations span all threads for the user
- Triggered automatically when token thresholds are reached
- Model IDs are plain strings resolved by Mastra's built-in model router
- Two memory instances: `interactiveMemory` (OM enabled) and `sharedMemory` (OM disabled)

**Scope choice:**
- **Resource** (default): Best for always-on interactive agents receiving inputs from multiple channels across time horizons. Observations build a unified picture of the user.
- **Thread**: Best when you need memory isolation between conversations. Each thread's observations are independent.

**Mode choice (`om_mode`):**
- **Static** (default): OM is set directly on the agent. Works everywhere — Studio, API, workflows, harness. Agent and harness share the same `interactiveMemory` instance.
- **Dynamic**: OM is injected by the harness at runtime via a factory. Allows per-thread model switching but only works through the harness.

**Use cases:**
- Automatic context compression for long conversations
- Cross-session learning without manual state management
- Replacing compaction processors with zero-config memory management

---

## Memory Scopes

The system uses two primary scopes for memory isolation:

### Thread Scope

Isolates memory to the current conversation.

```
User A, Conversation 1 → Thread: thread_user_a_conv_1
User A, Conversation 2 → Thread: thread_user_a_conv_2
```

**Used by:**
- Working Memory
- Session state
- Task-specific context

### Resource Scope

Groups all conversations for a single user/resource.

```
User A, All Conversations → Resource: user_a
  ├── Conversation 1
  ├── Conversation 2
  └── Conversation N
```

**Used by:**
- Semantic Recall
- User Preferences
- Cross-conversation learning

### Scope Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Resource: user_123                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────┐  ┌───────────────────┐              │
│  │ Thread A          │  │ Thread B          │              │
│  │                   │  │                   │              │
│  │ Working Memory A  │  │ Working Memory B  │  ← Thread    │
│  │ Recent Messages A │  │ Recent Messages B │    Scoped    │
│  │                   │  │                   │              │
│  └───────────────────┘  └───────────────────┘              │
│           │                      │                          │
│           └──────────┬───────────┘                          │
│                      ▼                                      │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Semantic Recall Pool                      │ │
│  │         (All messages across threads)                  │ │ ← Resource
│  │                                                        │ │   Scoped
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                │ │
│  │  │ Embed 1 │  │ Embed 2 │  │ Embed N │                │ │
│  │  └─────────┘  └─────────┘  └─────────┘                │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              User Preferences                          │ │
│  │    (Persists across all conversations)                 │ │ ← Resource
│  └───────────────────────────────────────────────────────┘ │   Scoped
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │           Observational Memory (OM)                    │ │
│  │    (Observations + reflections across threads)         │ │ ← Resource
│  └───────────────────────────────────────────────────────┘ │   Scoped
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Soul System Integration

The Soul System extends the memory architecture with personality and user context that persists at an even higher level - across all sessions, users, and conversations.

### Temporal Memory Layers

```
┌─────────────────────────────────────────────────────────┐
│                   TEMPORAL LAYERS                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Init-Time Memory (Soul System)                  │   │
│  │ ├─ SOUL.md      (Core truths, boundaries)       │   │
│  │ ├─ IDENTITY.md  (Name, creature, vibe)          │   │
│  │ └─ USER.md      (User context, preferences)     │   │
│  │                                                  │   │
│  │ Loaded once at startup, hot-reloaded on change  │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Resource-Time Memory                            │   │
│  │ ├─ User Preferences (learned over time)         │   │
│  │ ├─ Semantic Recall (cross-conversation)         │   │
│  │ └─ Observational Memory (OM observations +      │   │
│  │    reflections across all threads)              │   │
│  │                                                  │   │
│  │ Persists per-user, evolves across sessions      │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Thread-Time Memory                              │   │
│  │ ├─ Working Memory (task state)                  │   │
│  │ └─ Recent Messages (conversation context)       │   │
│  │                                                  │   │
│  │ Scoped to current conversation                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Soul Configuration Files

Located in `.agent/`:

#### IDENTITY.md
```markdown
# Identity

**Name**: Scion
**Creature**: Cosmic Crab
**Emoji**: 🦀
**Vibe**: Curious, helpful, precise

# Description
A cosmic being who helps navigate the universe of code...

# Voice
Speaks with clarity and confidence...
```

#### SOUL.md
```markdown
# Core Truths
- Clarity enables understanding
- Every question deserves thoughtful response
- Mistakes are learning opportunities

# Boundaries
- Never claim certainty when uncertain
- Respect user autonomy
- Avoid over-engineering

# Vibe
Calm presence in development chaos...

# Continuity
Remember context across conversations...
```

#### USER.md
```markdown
# User

**Name**: Sacha
**Timezone**: Europe/Berlin
**Pronouns**: they/them

# Preferences
- Concise responses
- TypeScript examples
- Bun over Node.js

# Context
Software developer working on AI agents...

# Goals
- Build robust AI assistant
- Maintain clean code
```

### User Preferences (Learned)

Beyond static configuration, the system learns preferences over time:

```typescript
interface UserPreferences {
  // Communication
  communicationStyle?: 'concise' | 'verbose' | 'documented' | 'casual';
  preferredLanguage?: string;  // e.g., "TypeScript"

  // Expertise calibration
  expertiseLevel?: 'beginner' | 'intermediate' | 'expert';
  domainsOfExpertise?: string[];
  domainsLearning?: string[];

  // Personalization
  howTheyLikeToBeAddressed?: string;
  topics?: string[];
  avoidTopics?: string[];

  // Goals
  currentProjects?: string[];
  currentGoals?: string[];

  // Response preferences
  preferEmoji?: boolean;
  preferCodeComments?: boolean;
  maxResponseLength?: 'short' | 'medium' | 'long';

  // Custom
  custom?: Record<string, string>;
}
```

Preferences are:
- Stored in `.agent/preferences/{resourceId}.json`
- Updated via the `update-user-preferences` tool
- Merged (not replaced) on update
- Validated against schema

---

## Session Management

### Session Key Structure

Sessions are identified by a deterministic key:

```
{channelType}:{channelId}:{optionalThreadId}
```

Examples:
- `slack:C123456:thread_abc` - Slack threaded conversation
- `telegram:12345` - Telegram direct message
- `discord:987654` - Discord conversation
- `scheduler:schedule:DailyReport` - Scheduled task

### Thread ID Generation

Thread IDs are generated deterministically from session keys:

```typescript
function getThreadId(sessionKey: string): string {
  const sanitized = sessionKey.replace(/[^a-zA-Z0-9]/g, '_');
  return `thread_${sanitized}`;
}
```

**Why deterministic?**
- Sessions survive server restarts
- Memory continuity without state persistence
- Reproducible across deployments

### Session Persistence

Sessions are tracked internally by the gateway using deterministic thread IDs derived from session keys. Thread IDs are generated by sanitizing the session key and prefixing with `thread_`.

**Lifecycle:**
1. **Create**: First message in new session
2. **Update**: Each interaction updates `lastActiveAt`
3. **Reset**: `/new` command creates fresh thread
4. **Cleanup**: Isolated sessions expire after TTL

### Session Reset

When user triggers `/new` or `/reset`:

1. Current session mapping is cleared
2. Next message creates new session with new threadId
3. Mastra thread history preserved (audit trail)
4. Working memory starts fresh

---

## Input Processors Pipeline

The processor pipeline controls how memory is integrated into agent context.

### Pipeline Order

```
Message → [1] Unicode Normalizer (if enabled)
        → [2] Adversarial Pattern Detector (if enabled)
        → [3] Prompt Injection Detector (if enabled)
        → [4] Compaction Processor (based on mode)
        → [5] Skills Processor
        → Agent
```

**Note:** Soul files are loaded via `loadSoulFiles()` in the agent's instructions function, not via an input processor.

### 1. Soul Loading

**Purpose:** Inject personality and context from Soul configuration files.

Soul files are loaded directly via `loadSoulFiles()` at agent initialization (not via a processor):

```typescript
const { identity, soul, user } = await loadSoulFiles();
```

**Behavior:**
- Loads SOUL.md, IDENTITY.md, USER.md from `.agent/`
- Injected into agent instructions
- Hot-reloaded when files change

**Note:** The `SoulLoaderProcessor` and `UserPreferencesProcessor` are defined but currently disabled (TODO: Re-enable after parser validation). Soul files are loaded directly in the agent's `instructions` function instead.

### 3. Unicode Normalizer

**Purpose:** Normalize text encoding for consistency.

Built-in Mastra processor that ensures consistent character encoding.

### 4. Skills Processor

**Purpose:** Generate tool definitions from skill metadata.

Converts workspace skills into available tools for the agent.

---

## Storage Architecture

### Storage Components

```typescript
// Database URL from agent.toml [memory].database_url
const dbUrl = memoryConfig.database_url;
const isUrl = dbUrl.includes('://');
const DB_PATH = isUrl ? dbUrl : `file:${resolveConfigPath(dbUrl)}`;

// Shared storage instance
export const storage = new LibSQLStore({
  id: 'agent-storage',
  url: DB_PATH,
});

// Vector storage for embeddings
export const vector = new LibSQLVector({
  id: 'agent-vector',
  url: DB_PATH,
});
```

### Storage Domains

LibSQLStore provides domain-specific storage:

| Domain | Purpose |
|--------|---------|
| `memory` | Thread/resource memory, messages |
| `agents` | Agent configuration, state |
| `workflows` | Workflow snapshots, state |
| `observability` | Traces, logs, metrics |
| `scores` | Evaluation scores |

### Memory Data Flow

```
User Message
     ↓
┌─────────────────────────────────────────┐
│           Mastra Memory                  │
├─────────────────────────────────────────┤
│                                         │
│  1. Save incoming message               │
│     └─ storage.memory.saveMessage()     │
│                                         │
│  2. Generate embedding                  │
│     └─ fastembed.embed(message)         │
│                                         │
│  3. Store embedding                     │
│     └─ vector.upsert(embedding)         │
│                                         │
│  4. Retrieve context                    │
│     ├─ Recent: getMessages(limit: 10)   │
│     ├─ Working: getWorkingMemory()      │
│     └─ Semantic: vectorSearch(query)    │
│                                         │
│  5. Return augmented context            │
│                                         │
└─────────────────────────────────────────┘
     ↓
Agent Generation
```

### Agent Memory Isolation

Different agents use separate Memory instances with different OM configurations:

**Interactive Agent** (`interactiveMemory`):
- Full memory (recent, semantic, OM)
- Observational Memory enabled (resource-scoped)
- Shared storage/vector backends
- Works everywhere: Studio, API, workflows, harness

**Task Agent** (`sharedMemory`):
- Memory without OM overhead (recent + semantic only)
- Same storage/vector backends
- No Observational Memory (task agents don't need long-term learning)

---

## Scheduler Memory Modes

Scheduled tasks have two session modes with different memory behaviors.

### Shared Mode (Default)

All executions share the same thread, accumulating context.

```markdown
## Daily Report
- **Schedule**: `0 9 * * *`
- **Thread Mode**: shared
```

**Memory behavior:**
- Same threadId for all runs
- Working memory accumulates
- Agent can reference past reports
- Semantic recall includes previous runs

**Use cases:**
- Daily summaries that build on each other
- Ongoing monitoring with trend analysis
- Tasks that benefit from historical context

### Isolated Mode

Each execution gets a fresh thread.

```markdown
## Security Scan
- **Schedule**: `0 * * * *`
- **Thread Mode**: isolated
- **SessionTTL**: 1d
```

**Memory behavior:**
- Unique threadId per execution
- No memory of previous runs
- Fresh working memory each time
- Session auto-deleted after TTL

**Use cases:**
- Independent analyses
- Security scans (no context contamination)
- Tasks requiring fresh perspective

### Session Cleanup

Isolated sessions are automatically cleaned up:

```typescript
// Runs hourly
cleanupIsolatedSessions({
  maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days default
});
```

Per-schedule TTL can override the global default.

---

## Configuration Reference

### Database Configuration

The database URL is configured in `agent.toml`, not via environment variables:

```toml
[memory]
database_url = "local.db"  # Relative to agent.toml, or absolute URL (libsql://)
```

### Memory Configuration

Two Memory instances are exported from `memory.ts`:

```typescript
// sharedMemory — used by task agent and tools (OM disabled)
new Memory({
  embedder: fastembed,
  storage: LibSQLStore,
  vector: LibSQLVector,
  options: {
    lastMessages: 30,
    semanticRecall: {
      topK: 5, messageRange: 2, scope: "resource",
    },
    observationalMemory: { enabled: false },
  },
});

// interactiveMemory — used by interactive agent (OM enabled)
new Memory({
  embedder: fastembed,
  storage: LibSQLStore,
  vector: LibSQLVector,
  options: {
    lastMessages: 30,
    semanticRecall: {
      topK: 5, messageRange: 2, scope: "resource",
    },
    observationalMemory: {
      enabled: true,
      scope: "resource",
      observation: {
        model: "google/gemini-2.5-flash",
        messageTokens: 50000,
        modelSettings: { maxOutputTokens: 60000 },
      },
      reflection: {
        model: "google/gemini-2.5-flash",
        observationTokens: 60000,
        modelSettings: { maxOutputTokens: 60000 },
      },
    },
  },
});
```

All values are read from `agent.toml` `[memory]` section — no defaults in the schema.

### Soul Loader Configuration

```typescript
new SoulLoaderProcessor({
  configPath: './config',    // Soul files directory
  verbose: true,             // Log loading events
  bootstrapMessage: '...',   // Custom bootstrap prompt
  onBootstrapNeeded: () => {},  // Bootstrap callback
});
```

---

## Best Practices

### 1. Memory Scope Selection

- Use **thread scope** for conversation-specific state
- Use **resource scope** for cross-conversation learning
- Don't mix scopes inappropriately

### 2. Working Memory Management

- Keep working memory structured and organized
- Update regularly during task execution
- Clear completed items to prevent bloat — use the `TaskArchive` tool to archive completed tasks to `.agent/TASK-ARCHIVE.md` and reset working memory for new goals
- Use consistent schema across sessions
- The heartbeat system detects when all tasks are complete and suggests archival

### 3. Semantic Recall Tuning

- Adjust `topK` based on context window size
- Higher `messageRange` for complex topics
- Monitor relevance threshold effectiveness
- Consider task-specific thresholds

### 4. Soul Configuration

- Keep SOUL.md focused on personality essentials
- Update IDENTITY.md for branding changes
- Let USER.md reflect actual user preferences
- Use preferences for learned behavior

### 5. Session Hygiene

- Use isolated mode for sensitive/independent tasks
- Configure appropriate TTLs for cleanup
- Monitor session accumulation
- Implement `/new` command for user resets

### 6. Storage Optimization

- Use shared storage for related agents
- Isolate task agents to prevent contamination
- Consider database size growth
- Implement archival for old threads

---

## Troubleshooting

### Memory Not Persisting

1. Check storage connection: `DATABASE_URL`
2. Verify thread ID consistency
3. Check for session reset events
4. Inspect storage domain: `memory`

### Soul Config Not Loading

1. Verify files exist in `configPath`
2. Check file permissions
3. Look for parse errors in logs
4. Validate markdown format

### Session Reset Not Working

1. Verify session key format
2. Confirm gateway adapter handling
3. Review reset command parsing
4. Check storage write permissions

---

## Related Documentation

- [Task Tools](./TASK_TOOLS.md) - Task management including TaskArchive for working memory cleanup
- [Heartbeat System](./HEARTBEAT_SYSTEM.md) - Proactive alerts including all-tasks-complete detection
- [Cron Session Management](./CRON_SESSION_MANAGEMENT.md)
- [Mastra Memory Documentation](https://mastra.ai/docs/memory)
