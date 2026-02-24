---
name: code-review-flow
version: "1.0.0"
description: Comprehensive code review with best practices, analysis, and recommendations
type: flow
---

# Code Review Flow

Perform a comprehensive code review by first identifying best practices,
  then analyzing the code, and finally providing actionable recommendations.

## Flow

```mermaid
flowchart TD
    BEGIN([BEGIN]) --> SETUP[Setup Context]
    SETUP --> BEST_PRACTICES[Best-practices]
    BEST_PRACTICES --> ANALYSIS[Analysis]
    ANALYSIS --> RECOMMENDATIONS[Recommendations]
    RECOMMENDATIONS --> END([END])
```

## Parameters

- **code** (required): The code to review
- **language**: Programming language [default: auto-detect]

## Steps

1. **best-practices**: Execute best-practices subflow
2. **analysis**: Execute analysis subflow
3. **recommendations**: Execute recommendations subflow

## Prompt

Review the following {{ language }} code:

  ```{{ language }}
  {{ code }}
  ```
