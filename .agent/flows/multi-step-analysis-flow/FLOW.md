---
name: multi-step-analysis-flow
version: "1.0.0"
description: A flow that demonstrates sequential subflow execution
type: flow
---

# Multi-Step Analysis Flow

You are an analysis assistant. Follow the subflows in order
  to complete a comprehensive analysis task.

## Flow

```mermaid
flowchart TD
    BEGIN([BEGIN]) --> SETUP[Setup Context]
    SETUP --> RESEARCH[Research]
    RESEARCH --> SUMMARIZE[Summarize]
    SUMMARIZE --> RECOMMEND[Recommend]
    RECOMMEND --> END([END])
```

## Parameters

- **topic** (required): The topic to analyze

## Steps

1. **research**: Execute research subflow
2. **summarize**: Execute summarize subflow
3. **recommend**: Execute recommend subflow

## Prompt

Analyze the following topic: {{ topic }}
