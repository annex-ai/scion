# Mastra Memory Schema ERD

This document provides a comprehensive Entity Relationship Diagram of the Mastra memory system as configured in this project.

## Overview

The memory system consists of three layers:
1. **Core Memory Tables** - Message history, threads, and working memory
2. **Vector Memory Tables** - Semantic search embeddings
3. **Observability Tables** - Tracing and evaluation data
4. **Application Layer** - User preferences schema

---

## Entity Relationship Diagram

```mermaid
erDiagram
    %% Core Memory Entities
    mastra_resources ||--o{ mastra_threads : owns
    mastra_resources ||--o{ mastra_messages : generates
    mastra_threads ||--o{ mastra_messages : contains
    mastra_threads ||--o{ mastra_threads : clones
    
    %% Vector Memory Relationships
    mastra_messages ||--o| memory_messages : embedded_as
    
    %% Agent Versioning
    mastra_agents ||--o{ mastra_agent_versions : has_versions
    
    %% Observability
    mastra_threads ||--o{ mastra_ai_spans : traced_in
    mastra_threads ||--o{ mastra_scorers : evaluated_in
    mastra_workflow_snapshot ||--o{ mastra_ai_spans : traced_in
    
    %% ============================================================
    %% CORE MEMORY TABLES
    %% ============================================================
    
    mastra_resources {
        TEXT id PK "Resource ID (e.g., 'interactive-agent')"
        TEXT workingMemory "Markdown working memory content"
        TEXT metadata "JSON metadata"
        TEXT createdAt "ISO timestamp"
        TEXT updatedAt "ISO timestamp"
    }
    
    mastra_threads {
        TEXT id PK "Thread UUID"
        TEXT resourceId FK "References mastra_resources.id"
        TEXT title "Thread title"
        TEXT metadata "JSON metadata (clone info, working memory)"
        TEXT createdAt "ISO timestamp"
        TEXT updatedAt "ISO timestamp"
    }
    
    mastra_messages {
        TEXT id PK "Message UUID"
        TEXT thread_id FK "References mastra_threads.id"
        TEXT content "JSON-encoded message content"
        TEXT role "user|assistant|system|tool"
        TEXT type "v1|v2 (message format version)"
        TEXT createdAt "ISO timestamp"
        TEXT resourceId FK "References mastra_resources.id"
    }
    
    %% ============================================================
    %% VECTOR MEMORY TABLES (Semantic Recall)
    %% ============================================================
    
    memory_messages {
        SERIAL id PK "Auto-increment ID"
        TEXT vector_id UK "Message UUID (links to mastra_messages)"
        F32_BLOB embedding "384-dim vector embedding"
        TEXT metadata "JSON: message_id, thread_id, resource_id, role, content"
    }
    
    libsql_vector_meta_shadow {
        TEXT name PK "Index name"
        BLOB metadata "Vector index metadata"
    }
    
    memory_messages_vector_idx_shadow {
        INTEGER index_key PK "Index entry key"
        BLOB data "Index data"
    }
    
    %% ============================================================
    %% WORKFLOW & AGENT TABLES
    %% ============================================================
    
    mastra_workflow_snapshot {
        TEXT workflow_name "Workflow identifier"
        TEXT run_id "Run UUID"
        TEXT resourceId FK "Resource ID"
        TEXT snapshot "JSON workflow state"
        TEXT createdAt "ISO timestamp"
        TEXT updatedAt "ISO timestamp"
    }
    
    mastra_agents {
        TEXT id PK "Agent ID"
        TEXT status "Agent status"
        TEXT activeVersionId FK "Current version ID"
        TEXT authorId "Author UUID"
        TEXT metadata "JSON metadata"
        TEXT createdAt "ISO timestamp"
        TEXT updatedAt "ISO timestamp"
    }
    
    mastra_agent_versions {
        TEXT id PK "Version UUID"
        TEXT agentId FK "References mastra_agents.id"
        INTEGER versionNumber "Sequential version number"
        TEXT name "Agent name"
        TEXT description "Agent description"
        TEXT instructions "System instructions"
        TEXT model "Model identifier"
        TEXT tools "JSON tool definitions"
        TEXT defaultOptions "JSON default options"
        TEXT workflows "JSON workflow refs"
        TEXT agents "JSON sub-agent refs"
        TEXT integrationTools "JSON integration tools"
        TEXT inputProcessors "JSON input processors"
        TEXT outputProcessors "JSON output processors"
        TEXT memory "JSON memory config"
        TEXT scorers "JSON scorer config"
        TEXT changedFields "JSON diff of changes"
        TEXT changeMessage "Version change description"
        TEXT createdAt "ISO timestamp"
    }
    
    %% ============================================================
    %% OBSERVABILITY TABLES
    %% ============================================================
    
    mastra_ai_spans {
        TEXT traceId "Trace UUID"
        TEXT spanId PK "Span UUID"
        TEXT name "Span name"
        TEXT spanType "Span category"
        INTEGER isEvent "Boolean flag"
        TEXT startedAt "ISO timestamp"
        TEXT parentSpanId "Parent span reference"
        TEXT entityType "Agent|Workflow|Tool"
        TEXT entityId "Entity identifier"
        TEXT entityName "Entity name"
        TEXT userId "User identifier"
        TEXT organizationId "Org identifier"
        TEXT resourceId FK "Resource reference"
        TEXT runId "Run identifier"
        TEXT sessionId "Session identifier"
        TEXT threadId FK "Thread reference"
        TEXT requestId "Request identifier"
        TEXT environment "dev|staging|prod"
        TEXT source "Source system"
        TEXT serviceName "Service identifier"
        TEXT scope "Scope identifier"
        TEXT metadata "JSON metadata"
        TEXT tags "JSON tags"
        TEXT attributes "JSON OTel attributes"
        TEXT links "JSON span links"
        TEXT input "Input data"
        TEXT output "Output data"
        TEXT error "Error message"
        TEXT endedAt "ISO timestamp"
        TEXT createdAt "ISO timestamp"
        TEXT updatedAt "ISO timestamp"
    }
    
    mastra_scorers {
        TEXT id PK "Score UUID"
        TEXT scorerId "Scorer identifier"
        TEXT traceId "Trace reference"
        TEXT spanId "Span reference"
        TEXT runId "Run reference"
        TEXT scorer "Scorer type"
        TEXT preprocessStepResult "Preprocessing output"
        TEXT extractStepResult "Extraction output"
        TEXT analyzeStepResult "Analysis output"
        REAL score "Numeric score"
        TEXT reason "Score explanation"
        TEXT metadata "JSON metadata"
        TEXT preprocessPrompt "Preprocess prompt"
        TEXT extractPrompt "Extract prompt"
        TEXT generateScorePrompt "Scoring prompt"
        TEXT generateReasonPrompt "Reasoning prompt"
        TEXT analyzePrompt "Analysis prompt"
        TEXT reasonPrompt "Reason prompt"
        TEXT input "Input data"
        TEXT output "Output data"
        TEXT additionalContext "Extra context"
        TEXT requestContext "Request metadata"
        TEXT entityType "Entity type"
        TEXT entity "Entity data"
        TEXT entityId "Entity ID"
        TEXT source "Source"
        TEXT resourceId FK "Resource reference"
        TEXT threadId FK "Thread reference"
        TEXT createdAt "ISO timestamp"
        TEXT updatedAt "ISO timestamp"
    }
    
    %% ============================================================
    %% APPLICATION-SPECIFIC ENTITIES
    %% ============================================================
    
    UserPreferences {
        TEXT resourceId PK "References mastra_resources.id"
        TEXT communicationStyle "concise|verbose|documented|casual"
        TEXT preferredLanguage "Programming language preference"
        TEXT codeStyle "Code style preference"
        TEXT expertiseLevel "beginner|intermediate|expert"
        TEXT domainsOfExpertise "JSON array"
        TEXT domainsLearning "JSON array"
        TEXT howTheyLikeToBeAddressed "Preferred name/title"
        TEXT topics "JSON array of interests"
        TEXT avoidTopics "JSON array"
        TEXT currentProjects "JSON array"
        TEXT currentGoals "JSON array"
        INTEGER preferEmoji "Boolean"
        INTEGER preferCodeComments "Boolean"
        TEXT maxResponseLength "short|medium|long"
        TEXT custom "JSON key-value preferences"
    }
    
    MemoryConfig {
        TEXT database_url "Path to SQLite DB"
        INTEGER last_messages "Number of recent messages"
        INTEGER semantic_recall_top_k "Vector search results count"
        INTEGER semantic_recall_message_range "Context window size"
        TEXT semantic_recall_scope "resource|thread"
        INTEGER working_memory_enabled "Boolean"
        TEXT working_memory_scope "resource|thread"
    }
```

---

## Table Descriptions

### Core Memory Tables

#### `mastra_resources`
Stores resource-scoped data. A resource is typically a user or entity that owns conversations.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT (PK) | Resource identifier (e.g., 'interactive-agent') |
| `workingMemory` | TEXT | Markdown content for resource-scoped working memory |
| `metadata` | TEXT | JSON metadata blob |
| `createdAt` | TEXT | ISO 8601 timestamp |
| `updatedAt` | TEXT | ISO 8601 timestamp |

#### `mastra_threads`
Represents conversation threads belonging to a resource.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT (PK) | Thread UUID |
| `resourceId` | TEXT (FK) | Owner resource reference |
| `title` | TEXT | Thread title (auto-generated or custom) |
| `metadata` | TEXT | JSON metadata including clone info and thread-scoped working memory |
| `createdAt` | TEXT | ISO timestamp |
| `updatedAt` | TEXT | ISO timestamp |

#### `mastra_messages`
Individual messages within a thread.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT (PK) | Message UUID |
| `thread_id` | TEXT (FK) | Parent thread reference |
| `content` | TEXT | JSON-encoded message (format depends on `type`) |
| `role` | TEXT | user, assistant, system, or tool |
| `type` | TEXT | v1 or v2 (message format version) |
| `createdAt` | TEXT | ISO timestamp |
| `resourceId` | TEXT (FK) | Resource reference |

### Vector Memory Tables

#### `memory_messages`
Vector embeddings for semantic search. Uses libSQL vector extension.

| Field | Type | Description |
|-------|------|-------------|
| `id` | SERIAL | Auto-increment primary key |
| `vector_id` | TEXT (UK) | Links to mastra_messages.id |
| `embedding` | F32_BLOB(384) | 384-dimensional float vector |
| `metadata` | TEXT | JSON with message context |

---

## Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                        RESOURCE SCOPE                            │
│  ┌─────────────────┐                                            │
│  │ mastra_resources│◄──────────────────────────────────┐        │
│  │  (User/Entity)  │                                   │        │
│  └────────┬────────┘                                   │        │
│           │ 1:N                                        │        │
│           ▼                                            │        │
│  ┌─────────────────┐     ┌──────────────────┐         │        │
│  │ mastra_threads  │◄────┤  Thread Clones   │         │        │
│  │ (Conversations) │ 1:N └──────────────────┘         │        │
│  └────────┬────────┘                                   │        │
│           │ 1:N                                        │        │
│           ▼                                            │        │
│  ┌─────────────────┐     ┌──────────────────┐          │        │
│  │ mastra_messages │◄────┤ memory_messages  │          │        │
│  │   (Messages)    │ 1:1 │ (Vector Search)  │          │        │
│  └─────────────────┘     └──────────────────┘          │        │
│                                                        │        │
│  WORKING MEMORY:                                       │        │
│  • Resource-scoped: mastra_resources.workingMemory     │        │
│  • Thread-scoped:   mastra_threads.metadata.workingMemory       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Memory Types Summary

| Memory Type | Storage Location | Scope | Use Case |
|-------------|-----------------|-------|----------|
| **Message History** | `mastra_messages` | Thread | Recent conversation context |
| **Working Memory** | `mastra_resources.workingMemory` | Resource | Persistent user profile data |
| **Semantic Recall** | `memory_messages` | Resource/Thread | Vector search across conversations |
| **Thread Metadata** | `mastra_threads.metadata` | Thread | Clone info, custom data |

---

## Configuration Mapping

The `agent.toml` `[memory]` section maps to the database schema:

```toml
[memory]
database_url = "data/local.db"                     → SQLite file path (relative to .agent/)
last_messages = 10                                 → Query limit for mastra_messages
semantic_recall_top_k = 3                          → LIMIT for vector search
semantic_recall_message_range = 2                  → Context messages around hits
semantic_recall_scope = "resource"                 → Search across resource's threads
working_memory_enabled = true                      → Enable working memory
working_memory_scope = "thread"                    → Store in thread metadata
```

---

## User Preferences Schema

Application-specific user preferences (stored via `user-preferences.ts`):

```typescript
interface UserPreferences {
  // Communication
  communicationStyle?: 'concise' | 'verbose' | 'documented' | 'casual'
  preferredLanguage?: string
  codeStyle?: string
  
  // Expertise calibration
  expertiseLevel?: 'beginner' | 'intermediate' | 'expert'
  domainsOfExpertise?: string[]
  domainsLearning?: string[]
  
  // Personalization
  howTheyLikeToBeAddressed?: string
  topics?: string[]
  avoidTopics?: string[]
  currentProjects?: string[]
  currentGoals?: string[]
  
  // Response style
  preferEmoji?: boolean
  preferCodeComments?: boolean
  maxResponseLength?: 'short' | 'medium' | 'long'
  
  // Custom key-values
  custom?: Record<string, string>
}
```

---

*Generated from Mastra memory documentation and live database schema.*
