---
name: test-loop-flow
version: "1.0.0"
description: Test flow with a loop pattern for build-time compiler verification
type: flow
---

# Test Loop Flow

A test flow to verify loop support in the build-time flow compiler.

## Flow

```mermaid
flowchart TD
    BEGIN([BEGIN]) --> SETUP[Setup Context]
    SETUP --> PROCESS[Process Item]
    PROCESS --> CHECK{More items?}
    CHECK -->|Yes| PROCESS
    CHECK -->|No| CLEANUP[Cleanup]
    CLEANUP --> END([END])
```

## Parameters

- **items** (required): List of items to process

## Steps

1. **Setup**: Initialize processing context
2. **Process**: Process each item (loops until done)
3. **Cleanup**: Finalize and return results

## Prompt

Process the following items:
{{ items }}
