# Reflection System

The Reflection System analyzes past conversations to extract patterns and writes them to REFLECTIONS.md for use on subsequent turns.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Workflow Pipeline](#workflow-pipeline)
- [Pattern Types](#pattern-types)
- [Heuristics](#heuristics)
- [Existing-Pattern Context](#existing-pattern-context)
- [File Format](#file-format)
- [HTTP API](#http-api)
- [File Structure](#file-structure)
- [Troubleshooting](#troubleshooting)

---

## Overview

The reflection system continuously learns: **"What patterns exist in conversations that should inform future interactions?"**

```
agent.toml [attention_steering] config
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              Mastra Workflow: reflection                       │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐│
│  │ 1. Collect   │→ │ 2. Analyze   │→ │ 3. Aggregate        ││
│  │    Messages  │  │    Patterns  │  │    & Write           ││
│  │  (from       │  │  (reflector  │  │    REFLECTIONS.md    ││
│  │   memory)    │  │   agent LLM) │  │  (merge + dedup)    ││
│  └─────────────┘  └──────────────┘  └──────────────────────┘│
│         ▲                │                                   │
│         │           reads existing                           │
│         │           REFLECTIONS.md                           │
│         │           for LLM context                          │
│         │                                                    │
│  ┌──────┴───────────────────────────────────────────────────┐│
│  │  Memory Storage (threads + messages)                      ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Workflow-based** | Mastra workflow with 3 steps, triggerable as agent tool or via HTTP |
| **LLM Analysis** | Reflector agent analyzes conversation exchanges in batches |
| **Existing-Pattern Context** | Feeds known patterns to LLM so it skips known observations |
| **Incremental Merge** | New patterns merge with existing REFLECTIONS.md (Jaccard dedup) |
| **Incremental Processing** | Tracks processed message IDs to avoid re-scanning |

---

## Quick Start

### 1. Configure in agent.toml

The reflection settings are in `.agent/agent.toml`:

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

Enable/disable the service via `[services].reflection = true/false`.

### 2. Trigger a Run

```bash
curl -X POST http://localhost:4111/api/workflows/reflection/start-async \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"resourceId": "interactive-agent"}}'
```

Or the interactive agent can self-trigger the reflection workflow as a registered tool.

### 3. Check Output

```bash
cat .agent/REFLECTIONS.md
```

---

## Configuration

### agent.toml

```toml
[attention_steering]
enable_reflections = true         # Enable reflection workflow
cron_schedule = "*/5 * * * *"     # Schedule for automated runs
max_messages_per_run = 1000       # Max messages to scan per run
min_batch_size = 10               # Min new messages before processing
max_pending_minutes = 30          # Force run after this staleness
reflections_md_path = "REFLECTIONS.md"         # Output file (relative to agent.toml)
reflection_state_path = "reflection-state.json" # State file (relative to agent.toml)
```

### Cron Schedule Examples

| Schedule | Description |
|----------|-------------|
| `*/5 * * * *` | Every 5 minutes (default) |
| `0 * * * *` | Every hour |
| `0 0 * * *` | Daily at midnight |
| `0 9,17 * * 1-5` | 9 AM and 5 PM on weekdays |

---

## Workflow Pipeline

The reflection workflow has three steps, executed sequentially:

### Step 1: Collect Messages (`collect-messages`)

Scans memory threads for unprocessed user/assistant exchange pairs:

- Loads processed message IDs from state file (incremental scanning)
- Queries all threads for the given `resourceId`
- Pairs each user query with its following assistant response
- Extracts reasoning/thinking content from assistant messages
- Skips short (<50 char) and tool-call-only responses

### Step 2: Analyze Patterns (`analyze-patterns`)

Calls the reflector agent (LLM) to analyze exchanges in batches of 5:

- **Reads existing REFLECTIONS.md** and parses known patterns + heuristics
- Passes existing patterns as context so the LLM can skip known observations
- For each batch, calls `reflector-agent` with structured output
- Extracts raw patterns (type, description, evidence, confidence) and insights

### Step 3: Aggregate and Write (`aggregate-and-write`)

Merges new patterns with existing REFLECTIONS.md:

- Deduplicates raw patterns from this run via Jaccard similarity
- Generates heuristics from curation suggestions
- Loads existing REFLECTIONS.md and merges (incremental update)
- Writes combined output to REFLECTIONS.md
- Saves processed message IDs to state file

---

## Pattern Types

### attention_signal

Patterns that indicate something important to remember:

```json
{
  "type": "attention_signal",
  "description": "Missing error handling in async functions",
  "evidence": "user/src/api.ts lines 45-67",
  "confidence": 0.85
}
```

### noise_pattern

Patterns that indicate things to filter out:

```json
{
  "type": "noise_pattern",
  "description": "Repeated explanations of React hooks dependencies",
  "evidence": "3 conversations in past week",
  "confidence": 0.75
}
```

### decision_marker

Patterns that indicate user preferences or decisions:

```json
{
  "type": "decision_marker",
  "description": "Preference for TypeScript in new projects",
  "evidence": "Explicitly stated in 4 separate conversations",
  "confidence": 0.92
}
```

---

## Heuristics

Heuristics are actionable rules generated from curation suggestions:

### Format

```
[name]: [condition] → [action] (weight: [0-1])
```

### Examples

| Suggestion | Heuristic |
|------------|-----------|
| "When discussing async code, check for error handling" | `heuristic_1: async code → check for error handling (weight: 0.5)` |
| "Prioritize TypeScript examples" | `heuristic_2: TypeScript → boost relevance (weight: 0.5)` |
| "Filter out repeated React hooks questions" | `heuristic_3: React hooks → reduce relevance (weight: 0.5)` |

### Parsing Patterns

The system recognizes these suggestion formats:

- **"When X, do Y"** / **"If X, then Y"**
- **"Prioritize X"** → condition: X, action: boost
- **"Filter out X"** / **"Remove X"** → condition: X, action: reduce
- **"Keep X"** / **"Preserve X"** → condition: X, action: preserve

---

## Existing-Pattern Context

When the reflector agent analyzes new exchanges, it receives existing patterns from REFLECTIONS.md as context. This allows the LLM to:

- **Skip known patterns** — avoid re-discovering observations already documented
- **Focus on new findings** — spend tokens on genuinely novel patterns
- **Note contradictions** — flag when new evidence contradicts a known pattern
- **Fill gaps** — prioritize pattern types underrepresented in the existing set

The context includes type, description, confidence, and occurrence count for each pattern (evidence is excluded to save tokens). Heuristics are included as condition/action pairs.

The mechanical merge in Step 3 remains as a safety net for deduplication.

---

## File Format

### REFLECTIONS.md

Generated file structure:

```markdown
# Reflections

> Auto-generated by reflection workflow. Last updated: 2026-02-11T12:00:00Z
> Scanned: 15 threads, 127 messages, 42 raw patterns

## Patterns

### Attention Signals
- Missing error handling in async functions (confidence: 0.93, occurrences: 3, evidence: ...)
- User prefers detailed code examples (confidence: 0.88, occurrences: 2, evidence: ...)

### Decision Markers
- Preference for TypeScript in new projects (confidence: 0.92, occurrences: 1, evidence: ...)

### Noise Patterns
- Repeated React hooks questions (confidence: 0.75, occurrences: 5, evidence: ...)

## Heuristics
- **heuristic_1**: async code → check for error handling (weight: 0.5)
- **heuristic_2**: TypeScript → prioritize examples (weight: 0.5)
- **heuristic_3**: React hooks after 3rd time → reduce relevance (weight: 0.5)
```

---

## HTTP API

### Trigger Manual Run

```bash
curl -X POST http://localhost:4111/api/workflows/reflection/start-async \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"resourceId": "interactive-agent"}}'
```

### Response

```json
{
  "status": "success",
  "results": {
    "aggregate-and-write": {
      "output": {
        "patternsCount": 15,
        "heuristicsCount": 4,
        "summary": "Wrote 15 patterns and 4 heuristics to REFLECTIONS.md"
      }
    }
  }
}
```

---

## File Structure

```
src/mastra/
├── workflows/
│   └── reflection-workflow.ts     # 3-step workflow (collect → analyze → write)
├── agents/
│   └── reflector.ts               # Reflector agent (LLM pattern extraction)
├── lib/
│   └── reflection-utils.ts        # Pure functions: merge, parse, dedup, buildBatchPrompt
.agent/
├── agent.toml                     # Reflection config ([attention_steering] section)
├── REFLECTIONS.md                 # Generated patterns (output)
└── reflection-state.json          # Processed message IDs (state)
```

### State Persistence

Reflection state is stored as a JSON file (`reflection-state.json`) alongside `agent.toml`:

```json
{
  "lastRunAt": "2026-02-11T12:00:00Z",
  "processedMessageIds": ["msg-1", "msg-2", "..."]
}
```

Processed IDs are pruned to the last 1000 entries to prevent unbounded growth.

---

## Troubleshooting

### Reflection not running

1. Check `[services].reflection = true` and `[attention_steering].enable_reflections = true` in `agent.toml`
2. Verify Mastra server is running on port 4111
3. Trigger manually via HTTP API
4. Check server logs for workflow errors

### No patterns found

1. Check that conversations exist in memory threads
2. Verify `resourceId` matches the agent's resource ID
3. Check that messages are long enough (>50 chars)
4. Ensure state file isn't marking all messages as already processed

### Patterns not merging

1. Check Jaccard similarity threshold (default: 0.6)
2. Verify patterns are same type
3. Check description similarity (word overlap after normalization)

### Full rescan each time

1. Check `reflection-state.json` exists and is writable
2. Verify state file path resolves correctly from agent.toml
3. Check for file system permission errors in logs

### File not written

1. Check write permissions on `.agent/`
2. Verify disk space available
3. Check for file system errors

---

## Migration Notes

### From Service-based to Workflow-based

**What changed:**
- `ReflectionService` (cron gateway service) replaced by `reflection-workflow.ts` (Mastra workflow)
- `ReflectorProcessor` (output processor) removed from the agent pipeline
- Workflow scans conversation history directly instead of requiring per-turn metadata injection
- Existing patterns from REFLECTIONS.md are fed to the LLM as context (avoids re-discovering known patterns)
- Incremental merge: new patterns merge with existing REFLECTIONS.md content

**What stayed the same:**
- Configuration section (`agent.toml [attention_steering]`)
- Output format (REFLECTIONS.md)
- Pattern types and heuristic format
- Deduplication via Jaccard word-set similarity
