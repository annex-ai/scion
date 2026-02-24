# Configurable Compaction Strategies

**Date:** 2026-02-13  
**Purpose:** User-configurable context compaction strategies via `agent.toml`

---

## Overview

Users can select their preferred compaction mode via `agent.toml`. Four modes are available:

1. **`none`** (Default) - No compaction (context limited by memory settings only)
2. **`time_based`** - Time-based compaction (summarizes messages older than N minutes)
3. **`token_limiter`** - Token-based limiting (threshold-driven truncation)
4. **`token_compaction`** - Token-based compaction with summarization + hard limit

---

## Configuration Schema

### agent.toml

```toml
[compaction]
# Mode selection: "none" | "token_limiter" | "token_compaction" | "time_based"
mode = "token_compaction"

# Token budget for context window
max_context_tokens = 12000

# Trigger threshold for compaction
trigger_threshold = 10000

# Time-based settings (actual clock time)
preserve_duration_minutes = 60  # Keep messages from last hour

# Summary/compaction settings
preserve_recent_messages = 6
strategy = "summarize"  # "summarize" (LLM) or "truncate" (simple removal)
model = "openrouter/openai/gpt-4o-mini"
max_summary_length = 400
preserve_decisions = true
preserve_errors = true
preserve_user_preferences = true
```

---

## Strategy Implementations

### 1. None (No Compaction)

```typescript
// No compaction processors
case "none":
  break;  // No compaction added
```

**What it does:**
- No compaction or truncation occurs
- Context is limited only by Mastra memory settings (`lastMessages`)

**When to use:**
- Default for most users
- Short to medium sessions (<30 turns)
- Cost-conscious (no compaction LLM calls)

---

### 2. Time-Based Strategy

```typescript
// Processes messages older than N minutes
case "time_based":
  return [new TimeCompactionProcessor({
    preserveDurationMinutes: config.preserve_duration_minutes,
  })];
```

**Configuration:**
```toml
[compaction]
mode = "time_based"
preserve_duration_minutes = 60
strategy = "summarize"  # Options: "summarize" | "truncate"
```

**Two modes:**

| Mode | Cost | Description |
|------|------|-------------|
| `"summarize"` | ~$0.002-0.005 | Uses LLM to create intelligent summary |
| `"truncate"` | $0 | Simply removes old messages with placeholder |

**Behavior:**
- Messages newer than `preserve_duration_minutes` are kept verbatim
- Messages older than the cutoff are summarized
- Uses actual message timestamps (createdAt)

**Example:**
```
Current time: 2:00 PM
preserve_duration_minutes = 60

Messages:
- 10:00 AM: "Hello" → Summarized
- 12:30 PM: "How are you?" → Summarized
- 1:45 PM: "What's new?" → Kept
- 1:55 PM: "Tell me more" → Kept

Result: Messages from 1:00 PM onwards kept, older summarized
```

**When to use:**
- Long-running sessions across multiple hours/days
- Want to preserve recent context regardless of message count
- Similar to "session timeout" behavior

---

### 3. Token Limiter

```typescript
// Token-based limiting (simple truncation)
case "token_limiter":
  return [
    new TokenLimiterProcessor({
      limit: config.trigger_threshold,
    })
  ];
```

**Configuration:**
```toml
[compaction]
mode = "token_limiter"
trigger_threshold = 10000
```

**When to use:**
- Strict token budget requirements
- Want predictable context size
- Cost-conscious (no LLM calls)

---

### 4. Token Compaction (Recommended for Long Sessions)

```typescript
// Token compaction with summarization
case "token_compaction":
  return [new TokenCompactionProcessor({
    tokenThreshold: config.trigger_threshold,
    preserveRecentMessages: config.preserve_recent_messages,
    strategy: config.strategy,  // "summarize" or "truncate"
    compactionModel: config.model,
    maxSummaryLength: config.max_summary_length,
    preserveDecisions: config.preserve_decisions,
    preserveErrors: config.preserve_errors,
    hardTokenLimit: config.max_context_tokens,
  })];
```

**Behavior:**
1. Counts tokens in conversation
2. When over `trigger_threshold`, summarizes older messages (or truncates)
3. Preserves recent N messages verbatim
4. Emergency truncation at `max_context_tokens`

**When to use:**
- Long sessions with complex context
- Want intelligent context summarization
- Best balance of quality and cost

---

## Integration with Agent

```typescript
// src/mastra/agents/interactive.ts
import { loadCompactionConfig, getCompactionDescription } from "../lib/config/context-management";

const compactionConfig = await loadCompactionConfig();
console.log(`[interactive-agent] Compaction: ${getCompactionDescription(compactionConfig)}`);

function buildContextProcessors(config: CompactionConfig) {
  const processors: any[] = [];

  // Compaction (manages context size)
  switch (config.mode) {
    case "token_limiter":
      processors.push(new TokenLimiterProcessor({ limit: config.trigger_threshold }));
      break;

    case "token_compaction":
      processors.push(new TokenCompactionProcessor({
        tokenThreshold: config.trigger_threshold,
        preserveRecentMessages: config.preserve_recent_messages,
        strategy: config.strategy,
        compactionModel: config.model,
        maxSummaryLength: config.max_summary_length,
        preserveDecisions: config.preserve_decisions,
        preserveErrors: config.preserve_errors,
        hardTokenLimit: config.max_context_tokens,
      }));
      break;

    case "time_based":
      processors.push(new TimeCompactionProcessor({
        preserveDurationMinutes: config.preserve_duration_minutes,
      }));
      break;

    case "none":
      break;
  }

  return processors;
}

export const interactiveAgent = new Agent({
  // ...
  inputProcessors: [
    // Security processors
    ...(unicodeNormalizer ? [unicodeNormalizer] : []),
    ...(adversarialPatternDetector ? [adversarialPatternDetector] : []),
    ...(promptInjectionProcessor ? [promptInjectionProcessor] : []),
    // Context management processors (compaction)
    ...buildContextProcessors(compactionConfig),
    // Skills
    new SkillsProcessor({ workspace }),
  ],
  // ...
});
```

---

## User Guide

### Quick Start

**For most users (default):**
```toml
[compaction]
mode = "none"
```

**For long coding sessions (hours):**
```toml
[compaction]
mode = "time_based"
preserve_duration_minutes = 120  # Keep last 2 hours
preserve_decisions = true
```

**For token-sensitive applications:**
```toml
[compaction]
mode = "token_limiter"
max_context_tokens = 8000
```

**For best quality (token compaction):**
```toml
[compaction]
mode = "token_compaction"
trigger_threshold = 12000
preserve_recent_messages = 8
strategy = "summarize"
```

---

## Mode Selection Guide

| Use Case | Recommended Mode | Key Config |
|----------|-----------------|------------|
| Quick questions (<10 turns) | `none` | Default |
| Coding sessions (10-30 turns) | `none` | Default |
| Long projects (30-50 turns) | `token_compaction` | trigger_threshold=10000 |
| Multi-hour sessions | `time_based` | preserve_duration_minutes=60 |
| Token-sensitive | `token_limiter` | max_context_tokens=8000 |
| Cost-sensitive | `none` | Default |
| Quality-first | `token_compaction` | preserve_recent_messages=10 |

---

## Cost Comparison by Mode

| Mode | Avg Cost/Turn | Best For |
|------|---------------|----------|
| `none` | ~$0.001 | Most use cases |
| `time_based` | ~$0.002-0.005 | Long sessions (summarization) |
| `token_limiter` | $0 | Token budget control |
| `token_compaction` | ~$0.002-0.005 | When summarization triggers |

---

## Validation

```typescript
export function validateCompactionConfig(config: CompactionConfig): string[] {
  const errors: string[] = [];

  if (config.mode === "token_compaction" || config.mode === "token_limiter") {
    if (config.trigger_threshold >= config.max_context_tokens) {
      errors.push("trigger_threshold must be less than max_context_tokens");
    }
  }
  
  if (config.mode === "time_based") {
    if (config.preserve_duration_minutes < 5) {
      errors.push("preserve_duration_minutes should be at least 5");
    }
    if (config.preserve_duration_minutes > 1440) {
      errors.push("preserve_duration_minutes should not exceed 24 hours");
    }
  }
  
  return errors;
}
```

---

## Migration from Default

Existing users don't need to change anything - `none` is the default.

To opt-in to compaction:

1. Add to `agent.toml`:
```toml
[compaction]
mode = "token_compaction"
```

2. Restart the agent

3. Verify in logs:
```
[compaction] Loaded: mode=token_compaction
[interactive-agent] Compaction: Token compaction (summarize at 10000, hard limit 12000 tokens)
```

---

## Future Enhancements

- **Auto-strategy**: Automatically switch based on session characteristics
- **Per-thread strategy**: Different strategies for different conversations
- **Adaptive threshold**: Adjust compaction threshold based on model
- **User preference learning**: Remember which strategy user prefers per context

---

*Document Version: 2.0*
