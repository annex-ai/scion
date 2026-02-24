# Input Processors User Guide

> A complete guide to understanding and configuring Scion's input processor pipeline.

---

## Table of Contents

1. [Overview](#overview)
2. [Processor Pipeline](#processor-pipeline)
3. [Individual Processors](#individual-processors)
4. [Configuration](#configuration)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Overview

Input processors transform, validate, and filter messages before they reach the LLM. They run in a specific order, with each processor receiving the output of the previous one.

### Why Use Input Processors?

- **Security**: Detect prompt injection, adversarial patterns, PII
- **Quality**: Normalize text, filter irrelevant content
- **Cost**: Reduce token usage by compacting context
- **Performance**: Stay within context window limits

---

## Processor Pipeline

The interactive agent uses the following processor pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│                    INPUT PROCESSOR PIPELINE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. UnicodeNormalizer                                           │
│     └─> Normalize Unicode, strip control chars                  │
│                                                                 │
│  2. AdversarialPatternDetector                                  │
│     └─> Fast regex-based attack detection                       │
│                                                                 │
│  3. PromptInjectionDetector                                     │
│     └─> LLM-based injection/jailbreak detection                 │
│                                                                 │
│  4. Context Processors (configurable)                           │
│     ├─> TimeCompactionProcessor (turn-based compaction)        │
│     ├─> TokenLimiterProcessor (token-based limiting)           │
│     └─> TokenCompactionProcessor (summarize + limit)           │
│                                                                 │
│  5. SkillsProcessor                                             │
│     └─> Load and inject skill context                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Execution Order Matters

Processors run sequentially. Each processor receives the **output** of the previous one:

```
User Input → Processor 1 → Processor 2 → Processor 3 → LLM
```

This means:
- Security processors run early (clean input first)
- Context compaction happens after security (work on clean input)
- Skills load last (they see the final context)

---

## Individual Processors

### 1. UnicodeNormalizer

**Type**: Mastra built-in  
**Purpose**: Normalize Unicode text for consistency

**What it does**:
- Normalizes Unicode characters (NFKC)
- Strips control characters
- Collapses whitespace
- Preserves emojis (configurable)

**Configuration**:
```toml
[security]
enableUnicodeNormalization = true  # Default: false
```

**When to enable**:
- Users paste text from various sources
- Dealing with non-English languages
- Seeing formatting inconsistencies

**Performance**: Zero-cost, deterministic

---

### 2. AdversarialPatternDetector

**Type**: Custom (Scion)  
**Purpose**: Fast regex-based attack detection

**What it does**:
- Detects common prompt injection patterns
- Identifies jailbreak attempts
- Catches system prompt leaks
- Blocks role-playing attacks

**Patterns detected**:
```
"Ignore previous instructions"
"You are now a DAN"
"System: you are..."
"Let's play a game"
"[System override]"
```

**Configuration**:
```toml
[security]
enableAdversarialPatternDetection = true  # Default: false
```

**When to enable**:
- Public-facing agents
- High-security environments
- When PromptInjectionDetector is too slow

**Performance**: Zero LLM calls, sub-millisecond latency

---

### 3. PromptInjectionDetector

**Type**: Mastra built-in  
**Purpose**: LLM-based injection/jailbreak detection

**What it does**:
- Uses a dedicated LLM to classify input
- Detects sophisticated injection attempts
- Can rewrite attacks to neutralize them
- Configurable strategy: block, rewrite, or detect

**Configuration**:
```toml
[security]
enablePromptInjectionDetection = true  # Default: false

[models]
prompt_injection = "openrouter/openai/gpt-oss-safeguard-20b"
```

**When to enable**:
- Maximum security required
- When regex patterns aren't enough
- Acceptable to add ~1 LLM call per request

**Performance**: Adds ~1 LLM call per message

**Note**: Configure `prompt_injection` model separately for cost control.

---

### 4. Context Processors (Configurable)

These processors manage the context window. Choose ONE strategy:

#### 4a. TimeCompactionProcessor

**Type**: Custom (Scion)
**Purpose**: Time-based context compaction

**What it does**:
- Keeps messages from the last N minutes verbatim
- Summarizes older messages using LLM
- Injects summary as system message
- Preserves decisions, errors, preferences

**Best for**:
- Long conversations (50+ turns)
- When recent context is most important
- Reducing token usage dramatically

**Configuration**:
```toml
[compaction]
mode = "time_based"
preserve_duration_minutes = 60  # Keep messages from last hour

# Compaction strategy: "summarize" (LLM, default) or "truncate" (simple removal)
strategy = "summarize"

# Options for summarize mode
model = "openrouter/openai/gpt-4o-mini"
preserve_decisions = true
preserve_errors = true
max_summary_length = 400
```

**How it works**:
1. Uses message timestamps to find cutoff (messages older than N minutes)
2. Keeps recent messages verbatim
3. Processes older messages based on `strategy`:
   - `"summarize"`: Uses LLM to create intelligent summary
   - `"truncate"`: Simply removes old messages with placeholder
4. Injects summary/truncation notice as system message
5. Removes old messages from context

**Cost comparison:**
| Strategy | Cost | Best For |
|----------|------|----------|
| `"summarize"` | ~$0.002-0.005 per compaction | Preserving context meaning |
| `"truncate"` | Free | Cost-sensitive applications |

**Example**:
```
Before: 50 messages (15,000 tokens)
After:  20 messages + 1 summary (6,000 tokens)
```

**Performance**: ~1 LLM call when compaction triggers

---

#### 4b. TokenLimiterProcessor

**Type**: Mastra built-in
**Purpose**: Token-based context limiting

**What it does**:
- Counts tokens in all messages
- Removes oldest messages when limit exceeded
- Prioritizes recent messages
- Simple truncation (no summarization)

**Best for**:
- Strict token budget control
- When you need predictable costs
- Quick sessions (< 20 turns)

**Configuration**:
```toml
[compaction]
mode = "token_limiter"
trigger_threshold = 10000      # Token threshold to trigger truncation
```

**How it works**:
1. Counts tokens in all messages
2. If over `trigger_threshold`, removes oldest messages
3. Returns processed message list

**Performance**: No LLM calls (fast token counting only)

---

#### 4c. Token Compaction (Recommended for Long Sessions)

**Type**: Custom (Scion)
**Purpose**: Intelligent context summarization with hard token limit

**What it does**:
- Monitors total token count in conversation
- When over threshold, summarizes older messages (or truncates)
- Preserves recent N messages verbatim
- Emergency truncation at hard token limit

**Best for**:
- Production deployments
- Long sessions with complex context
- Balancing quality and cost

**Configuration**:
```toml
[compaction]
mode = "token_compaction"
max_context_tokens = 15000
trigger_threshold = 12000
preserve_recent_messages = 8
strategy = "summarize"  # "summarize" or "truncate"
model = "openrouter/openai/gpt-4o-mini"
```

**How it works**:
1. Counts tokens across all messages
2. When over `trigger_threshold`, compacts older messages using chosen strategy
3. Preserves recent messages verbatim
4. Emergency truncation at `max_context_tokens`

**Performance**: One LLM call per compaction (if using `"summarize"` strategy)

---

### 5. SkillsProcessor

**Type**: Mastra built-in  
**Purpose**: Load and inject skill context

**What it does**:
- Loads available skills from workspace
- Injects skill descriptions into context
- Enables dynamic skill discovery
- Works with MCP tools

**Configuration**: No configuration needed

**When it runs**: Always (last in pipeline)

**Performance**: No LLM calls (metadata loading)

---

## Configuration

### Complete Example

```toml
# .agent/agent.toml

[security]
# Security processors
enableUnicodeNormalization = true
enableAdversarialPatternDetection = true
enablePromptInjectionDetection = true

[compaction]
# Compaction mode: none | token_limiter | token_compaction | time_based
mode = "token_compaction"
max_context_tokens = 15000

# Compaction settings
trigger_threshold = 12000
preserve_recent_messages = 8
strategy = "summarize"  # "summarize" or "truncate"
model = "openrouter/openai/gpt-4o-mini"
preserve_decisions = true
preserve_errors = true

# Time-based settings (actual clock time)
preserve_duration_minutes = 60  # Keep messages from last N minutes

[models]
# Models for various processors
default = "openrouter/openai/gpt-4o-mini"
prompt_injection = "openrouter/openai/gpt-oss-safeguard-20b"
```

### Mode Selection Guide

| Mode | Use Case | Cost | Complexity |
|------|----------|------|------------|
| `none` | Default, most users | Low | Simple |
| `time_based` | Long sessions (50+ turns) | Medium | Moderate |
| `token_limiter` | Strict token budgets | Low* | Simple |
| `token_compaction` | Production, best quality | Medium | Moderate |

\* Token cost depends on `strategy`: `"truncate"` is free, `"summarize"` costs ~$0.002-0.005 per compaction

---

## Best Practices

### 1. Start Simple

Begin with default configuration:
```toml
[compaction]
mode = "none"
```

Add processors incrementally based on needs.

### 2. Security First

Enable security processors for public-facing agents:
```toml
[security]
enableAdversarialPatternDetection = true
enablePromptInjectionDetection = true
```

### 3. Monitor Token Usage

Watch logs for compaction triggers:
```
[TimeCompaction] Reduced from 50 to 21 messages (with summary)
[TokenLimiter] Context reduced from 15000 to 9500 tokens
```

### 4. Choose Models Wisely

Use cheaper models for processors:
```toml
[models]
# Use small models for processors
default = "openrouter/openai/gpt-4o"              # Main agent
prompt_injection = "openrouter/openai/gpt-oss-safeguard-20b"  # Small, fast
```

### 5. Test Changes

After changing configuration:
1. Test with short conversation (5 turns)
2. Test with medium conversation (20 turns)
3. Test with long conversation (50+ turns)
4. Verify agent remembers key context

---

## Troubleshooting

### Issue: Agent forgets important context

**Symptoms**: Agent asks for information already provided

**Possible causes**:
- Compaction threshold too aggressive
- Token limit too low

**Solutions**:
```toml
# Option 1: Increase preservation
[compaction]
preserve_recent_messages = 12  # Was: 6

# Option 2: Use time_based instead of token_compaction
[compaction]
mode = "time_based"
```

---

### Issue: High token usage / costs

**Symptoms**: Token usage stays high despite compaction

**Possible causes**:
- Compaction not triggering
- Token limit too high
- System messages too verbose

**Solutions**:
```toml
# Option 1: Lower trigger threshold
[compaction]
trigger_threshold = 8000  # Was: 10000

# Option 2: Use token_limiter mode
[compaction]
mode = "token_limiter"
max_context_tokens = 8000

# Option 3: Reduce max messages
[compaction]
max_context_messages = 15  # Was: 25
```

---

### Issue: Slow response times

**Symptoms**: Agent takes too long to respond

**Possible causes**:
- Too many processors enabled
- PromptInjectionDetector adds LLM call

**Solutions**:
```toml
# Option 1: Disable slow processors
[security]
enablePromptInjectionDetection = false  # Use AdversarialPatternDetector instead

# Option 2: Use faster mode
[compaction]
mode = "token_limiter"  # No LLM calls
```

---

### Issue: Security false positives

**Symptoms**: Legitimate queries being blocked

**Possible causes**:
- AdversarialPatternDetector too strict
- PromptInjectionDetector threshold too low

**Solutions**:
```toml
# Option 1: Disable specific detector
[security]
enableAdversarialPatternDetection = false

# Option 2: Adjust PromptInjectionDetector
# (Requires code change to configure threshold)
```

---

### Issue: "No messages to process" error

**Symptoms**: TripWire error in logs

**Cause**: Empty message array passed to processor

**Solution**: This is a fatal error. Check:
1. Agent configuration
2. Memory configuration
3. Upstream processor output

---

## Debugging

### Enable Verbose Logging

```typescript
// In your agent code
console.log(`[interactive-agent] Compaction: ${getCompactionDescription(compactionConfig)}`);
```

### Check Processor Output

Add logging to track message counts:
```
[UnicodeNormalizer] Processed 10 messages
[AdversarialPatternDetector] No threats detected
[PromptInjectionDetector] Safe
[TokenLimiter] Reduced to 20 messages
```

### Test Individual Processors

```typescript
// Test TimeCompactionProcessor
const processor = new TimeCompactionProcessor({
  preserveDurationMinutes: 60
});

const result = await processor.processInput({
  messages: testMessages,
  messageList: testMessageList,
  systemMessages: [],
  // ... other args
});
```

---

## Advanced Topics

### Custom Processor Development

To create a custom processor:

```typescript
import type { Processor, ProcessInputArgs, ProcessInputResult } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";

export class MyCustomProcessor implements Processor<"my-processor"> {
  readonly id = "my-processor" as const;
  readonly name = "My Custom Processor";
  
  async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
    const { messageList } = args;
    const messages = messageList?.get.all.db() ?? args.messages;
    
    // Your processing logic here
    
    return messageList ?? messages;
  }
}
```

### Processor Ordering

To change processor order, edit `src/mastra/agents/interactive.ts`:

```typescript
inputProcessors: [
  new UnicodeNormalizer(),
  // Add your custom processor here
  new MyCustomProcessor(),
  new AdversarialPatternDetector(),
  // ... rest of processors
]
```

---

## Related Documentation

- [Configuration Guide](./CONFIGURATION.md)
- [Compaction Strategy Guide](./COMPACTION_STRATEGY.md)
- [Mastra Processors Docs](https://mastra.ai/reference/processors/processor-interface)

---

*Last updated: 2026-02-13*
