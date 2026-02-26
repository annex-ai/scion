# Adaptation System

The Adaptation System learns from conversations and delivers coaching suggestions through a three-stage pipeline: **Observe → Reflect → Coach**.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Pipeline Stages](#pipeline-stages)
  - [Observe](#observe)
  - [Reflect](#reflect)
  - [Coach](#coach)
- [Delivery & Feedback](#delivery--feedback)
- [Pattern State Machine](#pattern-state-machine)
- [Coaching Lifecycle](#coaching-lifecycle)
- [Configuration](#configuration)
- [Storage Layout](#storage-layout)
- [HTTP API](#http-api)
- [Concurrency & Locking](#concurrency--locking)
- [Migration from REFLECTIONS.md](#migration-from-reflectionsmd)
- [File Structure](#file-structure)
- [Troubleshooting](#troubleshooting)

---

## Overview

The adaptation system continuously learns from user interactions and delivers contextual coaching. It operates as a background pipeline with three stages:

| Stage | Purpose | Input | Output |
|-------|---------|-------|--------|
| **Observe** | Extract observations from conversations | Thread messages | `observations/pending/*.json` |
| **Reflect** | Synthesize observations into patterns | Pending observations | `patterns/active.json` |
| **Coach** | Generate coaching suggestions from patterns | Active patterns | `coaching/pending.json` |

Suggestions are delivered inline during conversations by the `AdaptationProcessor`, which matches pending suggestions against user messages via keyword triggers.

### Key Features

| Feature | Description |
|---------|-------------|
| **Three-stage pipeline** | Observe → Reflect → Coach, orchestrated by a master workflow |
| **Pattern state machine** | active → validated → stale → archived lifecycle |
| **Semantic dedup** | Jaccard similarity prevents duplicate suggestions |
| **Implicit feedback** | Tracks whether users engage with coaching topics |
| **User preferences** | Respects coaching style, frequency, and topic preferences |
| **Context-aware prompts** | Coach LLM receives delivery history and acceptance rates |
| **File-based locking** | PID locks prevent concurrent pipeline runs |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Adaptation Master Workflow                        │
│                     (cron-triggered or manual HTTP)                      │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │  1. Observe   │ →  │  2. Reflect   │ →  │  3. Coach               │  │
│  │              │    │              │    │                          │  │
│  │  Scan threads │    │  Synthesize  │    │  Generate suggestions   │  │
│  │  Extract      │    │  patterns    │    │  Filter by preferences  │  │
│  │  observations │    │  Reinforce/  │    │  Semantic dedup         │  │
│  │              │    │  stale/archive│    │  Expire old             │  │
│  └──────────────┘    └──────────────┘    └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Adaptation Processor                               │
│                    (Mastra input processor)                              │
│                                                                         │
│  On each conversation turn:                                             │
│  1. Load top N active patterns → inject as system context               │
│  2. Match pending coaching → claim & deliver if trigger matches         │
│  3. Check implicit feedback from previous coaching                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Pipeline Stages

### Observe

The observe workflow scans conversation threads and extracts raw observations using the observer agent (LLM).

**Workflow:** `observe-workflow.ts` (5 steps)

```
acquireLock → collectThreads → extractObservations → storeObservations → releaseLock
```

**What it does:**
1. Loads unprocessed user/assistant exchange pairs from memory threads
2. Skips tool-call-only responses and short messages (<50 chars)
3. Calls the observer agent in batches to extract typed observations
4. Saves observation batches to `observations/pending/`
5. Updates processed message IDs in state (keeps last 1000)

**Observation Types:**

| Type | Description | Confidence |
|------|-------------|------------|
| `user_frustration` | Explicit frustration | 0.9 |
| `user_correction` | User corrected the agent | 0.9 |
| `repeated_request` | Same request multiple ways | 0.8 |
| `positive_feedback` | Explicit satisfaction | 0.9 |
| `workflow_friction` | Inefficiency detected | 0.6 |
| `skill_gap` | User struggled with something | 0.7 |
| `preference_signal` | Implicit preference | 0.6 |
| `coaching_opportunity` | Teachable moment | 0.7 |

### Reflect

The reflect workflow synthesizes pending observations into durable patterns using the reflector agent (LLM) with heuristic fallback.

**Workflow:** `reflect-workflow.ts` (8 steps)

```
acquireLock → loadData → synthesizePatterns → archiveStale →
writePatterns → archiveObservations → updateState → releaseLock
```

**What it does:**
1. Loads pending observations and active patterns
2. Calls the reflector agent to match observations to existing patterns (reinforcement) or create new ones
3. Falls back to heuristic matching (Jaccard similarity >0.35) if LLM is unavailable
4. Updates the pattern state machine (see below)
5. Archives stale patterns older than 30 days
6. Moves processed observations from `pending/` to `processed/`

**Reflector Output Schema:**
```typescript
{
  reinforcements: [{ observationId, patternId, reason }],
  newPatterns: [{ type, pattern, guidance, confidence, coachingPriority, sourceObservationIds }],
  contradictions: [{ patternId, observationId, explanation }]
}
```

### Coach

The coach workflow generates actionable coaching suggestions from validated patterns.

**Workflow:** `coach-workflow.ts` (9 steps)

```
acquireLock → loadPatterns → filterByPreferences → checkExisting →
generateSuggestions → writeSuggestions → expireOld → updateState → releaseLock
```

**What it does:**
1. Loads patterns with `confidence >= 0.7` and `coachingPriority` set
2. Filters by user preferences (frequency, topics, avoid-topics)
3. Deduplicates against pending + recently delivered suggestions (by pattern ID and semantic similarity)
4. Calls the coach agent to generate structured suggestions with trigger keywords
5. Writes new suggestions to `coaching/pending.json`
6. Expires suggestions past their TTL

**Context-Aware Prompts:**

The coach agent receives enriched context for better suggestions:
- **User coaching style** — `direct`, `subtle`, or `socratic`
- **Delivery history** — how many suggestions were delivered recently
- **Acceptance rate** — if low (<30%), the prompt nudges a lighter approach
- **Recent topics** — to vary the coaching and avoid repetition

**Coaching Types:**

| Type | Description | Example |
|------|-------------|---------|
| `proactive_insight` | Offer insight before the user asks | "You often debug with console.logs — have you tried the debugger?" |
| `skill_building` | Help build a skill | "I noticed you've asked about generics. Want a quick overview?" |
| `process_optimization` | Suggest workflow improvement | "You frequently format code manually. Want me to auto-format?" |
| `reflection_prompt` | Prompt the user to reflect | "You've been working on this a while. Want to review the approach?" |

---

## Delivery & Feedback

### Delivery (AdaptationProcessor)

The `AdaptationProcessor` is a Mastra input processor that runs on every conversation turn. It:

1. **Injects patterns** — Top N active patterns are added as a system message (`## Learned Patterns`)
2. **Claims coaching** — If a pending suggestion's trigger keywords match the user's message, the suggestion is atomically claimed and injected (`## Coaching Opportunity`)
3. **Records feedback** — Checks if the user's message relates to a recently delivered suggestion

```typescript
// In the agent's input processor pipeline
const agent = new Agent({
  inputProcessors: [
    soulLoader,
    prefsProcessor,
    adaptationProcessor,  // Patterns + coaching
    skillsProcessor,
  ],
});
```

### Atomic Claim Mechanism

The claim system (`adaptation-claim.ts`) prevents race conditions when multiple requests could match the same suggestion:

1. Acquires a short-lived lock (`coaching-claim`, 5s timeout)
2. Scores all pending suggestions against the user's message
3. Claims the best match (highest score, then priority)
4. Marks it as `delivered` and moves it to `coaching/delivered/`
5. Releases the lock

**Scoring:**
- `+1` per matching keyword
- `+0.5` if any context matches
- `-2` per matching exclude keyword

### Implicit Feedback

After a coaching suggestion is delivered, the processor watches the user's next message within a 5-minute window:

- **Accepted** — The user's response contains any of the suggestion's trigger keywords (indicates engagement with the topic)
- **No response** — The user's response doesn't relate to the coaching topic

Feedback is recorded on the delivered suggestion and aggregated into delivery metrics (acceptance rate).

---

## Pattern State Machine

```
                    ┌───────────────────────┐
                    │                       │
        create      ▼     3+ occurrences    │  reinforced
    ──────────► [active] ──────────────► [validated] ◄──────┐
                    │                       │               │
                    │  3 runs without       │  3 runs       │
                    │  reinforcement        │  without      │
                    │                       │               │
                    ▼                       ▼               │
                 [stale] ◄───────────── [stale]             │
                    │                       │               │
                    │  reinforced           │               │
                    └───────────────────────┘               │
                    │                                       │
                    │  30+ days stale                       │
                    ▼                                       │
                [archived]                                  │
```

| State | Meaning | Transition |
|-------|---------|------------|
| `active` | Newly created pattern | → `validated` at 3+ occurrences |
| `validated` | High-confidence pattern | → `stale` after 3 runs without reinforcement |
| `stale` | No recent evidence | → `validated` if reinforced, → `archived` after 30 days |
| `archived` | Moved to monthly archive | Terminal |

**Constants:**

| Constant | Value | Description |
|----------|-------|-------------|
| `PATTERN_VALIDATE_THRESHOLD_OCCURRENCES` | 3 | Occurrences needed to validate |
| `PATTERN_STALE_THRESHOLD_RUNS` | 3 | Runs without reinforcement before stale |
| `PATTERN_ARCHIVE_THRESHOLD_DAYS` | 30 | Days stale before archiving |
| `JACCARD_SIMILARITY_THRESHOLD` | 0.7 | Similarity threshold for semantic dedup |

---

## Coaching Lifecycle

```
┌─────────┐  generated   ┌─────────┐  trigger match   ┌───────────┐
│ Pattern │ ────────────► │ Pending │ ────────────────► │ Delivered │
└─────────┘              └─────────┘                   └───────────┘
                              │                             │
                              │  past expiration           │  user engages?
                              ▼                             ▼
                         ┌─────────┐               ┌────────────────┐
                         │ Expired │               │ accepted /     │
                         └─────────┘               │ noResponse     │
                                                   └────────────────┘
```

**Suggestion States:**

| State | Description |
|-------|-------------|
| `pending` | Waiting for trigger match |
| `delivered` | Injected into a conversation |
| `accepted` | User engaged with the topic (implicit feedback) |
| `dismissed` | Reserved for explicit dismissal |
| `expired` | TTL exceeded without delivery |

**Expiration TTL (by priority):**

| Priority | TTL |
|----------|-----|
| `high` | 3 days |
| `medium` | 7 days |
| `low` | 14 days |

---

## Configuration

### agent.toml

```toml
[adaptation]
enabled = true
max_messages_per_run = 1000      # Max messages to scan per observe run
max_instruction_patterns = 15    # Max patterns injected per turn
observer_batch_size = 5          # Exchanges per observer LLM call
coaching_enabled = true
coaching_max_pending = 5         # Max pending suggestions at once
coaching_dedup_window_days = 7   # Days to check for dedup
```

### User Preferences

Per-user coaching preferences are stored in `.agent/preferences/{resourceId}.json` and respected by the coach workflow:

| Preference | Values | Effect |
|------------|--------|--------|
| `coachingFrequency` | `always`, `rare`, `never` | Controls how often suggestions are generated |
| `coachingStyle` | `direct`, `subtle`, `socratic` | Influences LLM prompt style |
| `coachingTopics` | `string[]` | Only generate for these topics |
| `avoidCoachingTopics` | `string[]` | Never generate for these topics |

---

## Storage Layout

All adaptation data lives in `.agent/adaptation/`:

```
.agent/adaptation/
├── state.json                    # Pipeline state (last run timestamps, processed IDs)
├── metrics.json                  # Aggregated metrics (observe, reflect, coach, delivery)
├── locks/                        # PID-based lock files
│   ├── observe.lock
│   ├── reflect.lock
│   ├── coach.lock
│   └── coaching-claim.lock
├── observations/
│   ├── pending/                  # Unprocessed observation batches
│   │   └── 2026-02-25T12-00-00.000Z.json
│   └── processed/                # Archived after reflect stage
│       └── 2026-02/
│           └── 2026-02-25T12-00-00.000Z.json
├── patterns/
│   ├── active.json               # Current active patterns
│   └── archive/                  # Monthly archives of stale patterns
│       └── 2026-02.json
└── coaching/
    ├── pending.json              # Suggestions awaiting delivery
    ├── delivered/                 # Delivered suggestions (by day)
    │   └── 2026-02/
    │       └── 25.json
    └── expired/                  # Expired suggestions (by month)
        └── 2026-02.json
```

### State File

```json
{
  "lastObserveRun": "2026-02-25T12:00:00Z",
  "lastReflectRun": "2026-02-25T12:05:00Z",
  "lastCoachRun": "2026-02-25T12:10:00Z",
  "processedMessageIds": ["msg-1", "msg-2"],
  "runCount": 42
}
```

### Metrics File

```json
{
  "observe": {
    "lastRun": "2026-02-25T12:00:00Z",
    "lastDuration": 3500,
    "threadsScanned": 5,
    "observationsCreated": 8,
    "byType": { "user_frustration": 2, "preference_signal": 3, "coaching_opportunity": 3 }
  },
  "reflect": {
    "lastRun": "2026-02-25T12:05:00Z",
    "lastDuration": 2100,
    "observationsProcessed": 8,
    "patternsCreated": 2,
    "patternsReinforced": 3,
    "patternsStaled": 1,
    "patternsActive": 12
  },
  "coach": {
    "lastRun": "2026-02-25T12:10:00Z",
    "lastDuration": 4200,
    "suggestionsGenerated": 2,
    "suggestionsExpired": 1,
    "pendingCount": 3
  },
  "delivery": {
    "totalDelivered": 15,
    "accepted": 6,
    "dismissed": 0,
    "noResponse": 9,
    "acceptanceRate": 0.4
  }
}
```

---

## HTTP API

### Trigger Full Pipeline

```bash
curl -X POST http://localhost:4111/api/workflows/adaptation/start-async \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"resourceId": "interactive-agent"}}'
```

### Trigger Single Stage

```bash
# Observe only
curl -X POST http://localhost:4111/api/workflows/adaptation/start-async \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"resourceId": "interactive-agent", "stage": "observe"}}'

# Reflect only
curl -X POST http://localhost:4111/api/workflows/adaptation/start-async \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"resourceId": "interactive-agent", "stage": "reflect"}}'

# Coach only
curl -X POST http://localhost:4111/api/workflows/adaptation/start-async \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"resourceId": "interactive-agent", "stage": "coach"}}'
```

---

## Concurrency & Locking

Each pipeline stage uses PID-based file locks to prevent concurrent runs:

- Lock files are stored in `.agent/adaptation/locks/`
- Each lock contains `{ pid, timestamp, workflow }`
- Stale locks (>10 minutes or dead process) are automatically reclaimed
- The `withLock(name, fn)` helper provides try/finally semantics

| Lock | Scope | Max Age |
|------|-------|---------|
| `observe` | One observe run at a time | 10 min |
| `reflect` | One reflect run at a time | 10 min |
| `coach` | One coach run at a time | 10 min |
| `coaching-claim` | Atomic suggestion claim | 5 sec |

---

## Migration from REFLECTIONS.md

The adaptation system supersedes the legacy `REFLECTIONS.md` pattern storage. A migration utility (`adaptation-migration.ts`) converts existing patterns:

1. Parses `REFLECTIONS.md` using `parseReflectionsMd()`
2. Converts `AggregatedPattern` entries to `AdaptationPattern` format (state: `validated`)
3. Converts heuristics to patterns with type `heuristic`
4. Saves to `patterns/active.json`
5. Renames `REFLECTIONS.md` to `REFLECTIONS.md.legacy`

```bash
# Check if migration is needed
bun -e "import { needsMigration } from './src/mastra/lib/adaptation-migration'; console.log(needsMigration())"

# Run migration
bun -e "import { runMigration } from './src/mastra/lib/adaptation-migration'; runMigration()"
```

---

## File Structure

```
src/mastra/
├── workflows/
│   ├── adaptation-master.ts       # Orchestrator: observe → reflect → coach
│   ├── observe-workflow.ts        # Stage 1: extract observations from threads
│   ├── reflect-workflow.ts        # Stage 2: synthesize patterns from observations
│   └── coach-workflow.ts          # Stage 3: generate coaching suggestions
├── agents/
│   ├── observer.ts                # Observer agent (observation extraction)
│   ├── reflector.ts               # Reflector agent (pattern synthesis)
│   └── coach.ts                   # Coach agent (suggestion generation)
├── processors/
│   └── adaptation-processor.ts    # Input processor: injects patterns + coaching
├── lib/
│   ├── adaptation-types.ts        # Types, schemas, constants
│   ├── adaptation-storage.ts      # JSON file read/write for all data
│   ├── adaptation-lock.ts         # PID-based file locking
│   ├── adaptation-claim.ts        # Atomic coaching claim mechanism
│   └── adaptation-migration.ts    # Legacy REFLECTIONS.md migration
```

### Key Dependencies

| File | Depends On | Used By |
|------|------------|---------|
| `adaptation-master.ts` | Sub-workflows, lock, storage, config | Cron scheduler, HTTP API |
| `observe-workflow.ts` | Observer agent, storage, lock | Master workflow |
| `reflect-workflow.ts` | Reflector agent, storage, lock, reflection-utils | Master workflow |
| `coach-workflow.ts` | Coach agent, storage, lock, user-preferences | Master workflow |
| `adaptation-processor.ts` | Storage, claim, config | Interactive agent (input processor) |
| `adaptation-claim.ts` | Storage, lock | Adaptation processor |
| `adaptation-storage.ts` | `node:fs`, config | All workflows, processor, claim |

---

## Troubleshooting

### Pipeline not running

1. Check `[adaptation].enabled = true` in `agent.toml`
2. Verify the Mastra server is running on port 4111
3. Trigger manually via HTTP API
4. Check server logs for workflow errors

### No observations created

1. Verify conversations exist in memory threads
2. Check `resourceId` matches the agent's resource ID
3. Ensure messages are long enough (>50 chars)
4. Check the state file — messages may already be in `processedMessageIds`

### No coaching suggestions

1. Check `[adaptation].coaching_enabled = true`
2. Verify patterns exist in `patterns/active.json` with `coachingPriority` set
3. Check that patterns have `confidence >= 0.7`
4. Check user preferences — `coachingFrequency` may be `never`
5. Check `coaching/pending.json` — max pending may be reached

### Lock stuck

1. Check `.agent/adaptation/locks/` for stale lock files
2. Locks auto-expire after 10 minutes
3. If the holding process is dead, the next run will reclaim the lock
4. Manual removal: `rm .agent/adaptation/locks/<name>.lock`

### Suggestions not delivering

1. Verify suggestions exist in `coaching/pending.json` with state `pending`
2. Check that trigger keywords match user messages
3. Check for exclude keywords blocking delivery
4. Ensure the `AdaptationProcessor` is in the agent's input processor pipeline

---

## Related Documentation

- [REFLECTION_SYSTEM.md](REFLECTION_SYSTEM.md) — Legacy reflection workflow (superseded by adaptation pipeline)
- [SERVICES.md](SERVICES.md) — Gateway services including cron scheduling
- [MEMORY_SYSTEM.md](MEMORY_SYSTEM.md) — Memory architecture and thread management
- [CONFIGURATION.md](CONFIGURATION.md) — Full agent.toml reference
