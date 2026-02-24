# Reflection Workflow API Documentation

**Status:** ✅ Implemented
**Location:** `src/mastra/workflows/reflection-workflow.ts`
**Purpose:** Analyzes past conversations to extract patterns for self-improving context curation

---

## Overview

The reflection workflow provides **batch conversation analysis** that:
- Scans memory threads for user/assistant exchange pairs
- Calls the reflector agent (LLM) to extract patterns and insights
- Feeds existing patterns as LLM context to avoid re-discovering known observations
- Deduplicates and merges patterns incrementally into `REFLECTIONS.md`
- Generates actionable heuristics from curation suggestions

**Integration:** Writes patterns to REFLECTIONS.md for use on subsequent turns.

---

## Architecture

```
┌──────────────────────┐     ┌──────────────────┐
│  Reflection Workflow  │     │  Reflector Agent  │
│  (3-step pipeline)   │     │  (LLM analysis)   │
└──────────┬───────────┘     └────────┬──────────┘
           │                          │
           │ 1. Collect exchanges     │ 2. Analyze with
           │    from memory threads   │    existing context
           │                          │
           ▼                          ▼
     memory storage             REFLECTIONS.md
     (query/response)           (incremental merge)
```

---

## Workflow Steps

### Step 1: `collect-messages`

Reads unprocessed query/response pairs from memory threads.

**Input:** `{ resourceId: string }`
**Output:** `{ pairs, processedIds, threadsScanned, messagesScanned }`

### Step 2: `analyze-patterns`

Calls the reflector agent to analyze exchanges in batches of 5. Reads existing REFLECTIONS.md and passes known patterns/heuristics as LLM context.

**Input:** collect-messages output
**Output:** `{ rawPatterns, insights, processedIds, threadsScanned, messagesScanned }`

### Step 3: `aggregate-and-write`

Merges new patterns with existing REFLECTIONS.md and writes the combined output.

**Input:** analyze-patterns output
**Output:** `{ patternsCount, heuristicsCount, summary }`

---

## Types

```typescript
interface RawPattern {
  type: 'attention_signal' | 'noise_pattern' | 'decision_marker';
  description: string;
  evidence: string;
  confidence: number;
  sourceThread: string;
  timestamp: string;
}

interface AggregatedPattern {
  type: 'attention_signal' | 'noise_pattern' | 'decision_marker';
  description: string;
  evidence: string;
  confidence: number;
  occurrences: number;         // Deduplication count
  lastValidated: string;
  sourceThreads: string[];     // Thread IDs where found
}

interface Heuristic {
  name: string;
  condition: string;           // e.g., "message contains 'decided'"
  action: string;              // e.g., "preserve message"
  weight: number;              // 0-1 influence on scoring
  source: string;              // Thread or 'reflections'
}
```

---

## Key Functions

### `buildBatchPrompt(pairs, existingPatterns?, existingHeuristics?)`

**Location:** `src/mastra/lib/reflection-utils.ts`

Builds the analysis prompt for a batch of exchanges. When existing patterns/heuristics are provided and non-empty, prepends "Already Known Patterns" and "Already Known Heuristics" context sections and instructs the LLM to focus on new observations.

```typescript
// Without existing context — basic prompt
buildBatchPrompt(pairs);

// With existing context — LLM sees known patterns
buildBatchPrompt(pairs, existingPatterns, existingHeuristics);
```

The existing-pattern context includes type, description, confidence, and occurrence count per pattern. Evidence is excluded to save tokens (~2.3K tokens overhead for 100 patterns + 20 heuristics).

### `mergeAggregatedPatterns(existing, incoming)`

Merges incoming patterns with existing ones. Matches by same type AND Jaccard similarity of description. On match: sums occurrences, takes max confidence, updates lastValidated, unions sourceThreads. Caps at 50 patterns.

### `mergeHeuristics(existing, incoming)`

Deduplicates by condition similarity (threshold 0.7). Appends new heuristics with renumbered names. Caps at 20 heuristics.

### `parseReflectionsMd(content)`

Parses REFLECTIONS.md content into structured `{ patterns: AggregatedPattern[], heuristics: Heuristic[] }`.

---

## Configuration

### agent.toml

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

---

## Pattern Processing

### Deduplication

Patterns are deduplicated using **Jaccard word-set similarity** with word normalization:

```typescript
// Example: These patterns would be merged
"Messages containing 'remember this' indicate important context"
"When user says 'remember this', it's important"

// Jaccard similarity > 0.6 → merged
// Confidence: max of both
// Occurrences: summed
```

### Confidence Scoring

```typescript
// Within a single run (mergePatterns):
// Similar patterns boost confidence by +0.1 * new_confidence
existing.confidence = Math.min(1.0, existing.confidence + pattern.confidence * 0.1);

// Across runs (mergeAggregatedPatterns):
// Takes max confidence of the two
merged.confidence = Math.max(existing.confidence, incoming.confidence);
```

---

## Output Format

### REFLECTIONS.md

```markdown
# Reflections

> Auto-generated by reflection workflow. Last updated: 2026-02-11T10:30:00Z
> Scanned: 15 threads, 1234 messages, 42 raw patterns

## Patterns

### Attention Signals
- Messages containing "remember this" indicate important context
  (confidence: 0.85, occurrences: 12, evidence: "Remember this for later")

### Decision Markers
- Assistant stating "I decided to use X" is critical for continuity
  (confidence: 0.95, occurrences: 15, evidence: "I decided to use PostgreSQL")

### Noise Patterns
- Greeting exchanges rarely relevant to technical questions
  (confidence: 0.78, occurrences: 23, evidence: "Hello! How are you?")

## Heuristics
- **heuristic_1**: message contains "remember" → boost relevance score (weight: 0.5)
- **heuristic_2**: message contains "decided" → preserve message (weight: 0.9)
```

---

## HTTP API

### Trigger Workflow

```bash
curl -X POST http://localhost:4111/api/workflows/reflection/start-async \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"resourceId": "interactive-agent"}}'
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "No pairs to analyze" | No unprocessed messages in memory | Check conversations exist, verify resourceId |
| Empty REFLECTIONS.md | No patterns extracted by LLM | Check reflector agent model config, review logs |
| Stale patterns | Workflow not running | Trigger manually, check cron schedule |
| Re-discovering known patterns | Existing context not loaded | Check REFLECTIONS.md is readable, verify path |

---

*Document Version: 2.0*
*Last Updated: 2026-02-11*
