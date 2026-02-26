---
name: greeting-flow
type: flow
description: A simple greeting flow for testing nativeFlow execution
---

# Greeting Flow

A minimal flow that greets the user.

```mermaid
flowchart TD
    BEGIN([BEGIN]) --> GREET[Greet the user warmly based on their request]
    GREET --> END([END])
```
