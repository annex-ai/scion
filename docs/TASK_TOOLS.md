# Task Tools Documentation

Complete guide to the Scion agent's task management system, including Claude Code-style progress tracking, task orchestration with AI decomposition, and specialized subagent task execution.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Core Task Tools](#core-task-tools)
  - [TaskCreate](#taskcreate)
  - [TaskGet](#taskget)
  - [TaskList](#tasklist)
  - [TaskUpdate](#taskupdate)
  - [TaskArchive](#taskarchive)
- [Task Planner](#task-planner)
- [Task Agent (Subagents)](#task-agent-subagents)
- [Working Memory Format](#working-memory-format)
- [Task Orchestration State](#task-orchestration-state)
- [Usage Examples](#usage-examples)
- [File Structure](#file-structure)

---

## Overview

The Task Tools system provides three complementary approaches to task management:

| Approach | Purpose | Best For |
|----------|---------|----------|
| **Core Task Tools** | Simple CRUD operations on tasks | Manual task tracking, todo lists |
| **TaskArchive** | Archive completed tasks & reset memory | End-of-goal cleanup, memory hygiene |
| **Task Planner** | AI-powered goal decomposition | Complex multi-step goals |
| **Task Agent** | Specialized subagent execution | Delegated work with specific expertise |

```
┌─────────────────────────────────────────────────────────────────┐
│                     Task Management System                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ TaskCreate   │  │ TaskGet      │  │ TaskList             │  │
│  │ TaskUpdate   │  │              │  │                      │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────────┘  │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Working Memory (Markdown)                   │    │
│  │  ### Pending Tasks:                                      │    │
│  │  - [ ] [#1] Fix authentication bug                       │    │
│  │    Need to update JWT handling...                        │    │
│  │  - [-] [#2] Add user profile                             │    │
│  │                                                          │    │
│  │  ### Completed Tasks:                                    │    │
│  │  - [x] [#3] Setup project                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────┐        ┌────────────────────────────┐    │
│  │ Task Planner     │        │ Task Agent                 │    │
│  │ (task-planner)   │        │ (task-agent)               │    │
│  ├──────────────────┤        ├────────────────────────────┤    │
│  │ • create plan    │        │ • Bash subagent            │    │
│  │ • get plan       │        │ • Research subagent        │    │
│  │ • list plans     │        │ • Plan subagent            │    │
│  │ • cancel plan    │        │ • general-purpose          │    │
│  └────────┬─────────┘        └────────────┬───────────────┘    │
│           │                               │                      │
│           ▼                               ▼                      │
│  ┌──────────────────┐        ┌────────────────────────────┐    │
│  │ Task Plans       │        │ Task Execution             │    │
│  │ (.blackboard/)   │        │ (delegated to subagent)    │    │
│  └──────────────────┘        └────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture

### Design Principles

1. **Progressive Complexity**: Start with simple task tracking, escalate to AI planning when needed
2. **Memory-Backed**: All task state stored in agent's working memory for persistence
3. **Composable**: Tools work independently or together
4. **Context-Aware**: Tasks maintain thread/resource context through Mastra memory

### Data Flow

```
User Request
     │
     ▼
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Main Agent  │────▶│ Task Tool       │────▶│ Working Memory  │
│             │     │ (create/update) │     │ (Markdown)      │
└─────────────┘     └─────────────────┘     └─────────────────┘
                                                          │
     ┌──────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Heartbeat       │◀────│ Parse Tasks     │◀────│ Memory Store    │
│ (check working  │     │ (task-helpers)  │     │ (LibSQL/        │
│  memory step)   │     │                 │     │  PostgreSQL)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## Core Task Tools

Claude Code-style task management with markdown-based working memory storage.

### TaskCreate

AI-powered goal decomposition that breaks a high-level goal into actionable subtasks in working memory.

**Input Schema:**
```typescript
{
  goal: string;  // The overarching objective that provides context
  task: string;  // The specific work item to decompose into subtasks
}
```

**Output Schema:**
```typescript
{
  success: boolean;
  taskIds: string[];    // IDs of all created subtasks
  tasks: Array<{
    id: string;
    subject: string;
    description: string;
    status: string;
    blockedBy: string[];
  }>;
  message: string;
}
```

**Example:**
```typescript
// Decompose a goal into subtasks
const result = await taskCreateTool.execute({
  goal: "Implement user authentication",
  task: "Add JWT token validation to the auth middleware"
}, context);

// Returns:
// {
//   success: true,
//   taskIds: ["1", "2", "3"],
//   tasks: [
//     { id: "1", subject: "Research JWT libraries", ... },
//     { id: "2", subject: "Implement token validation", blockedBy: ["1"], ... },
//     { id: "3", subject: "Add middleware integration", blockedBy: ["2"], ... },
//   ],
//   message: "Created 3 tasks"
// }
```

**Key Behaviors:**
- Uses an AI decomposition agent to break goals into subtasks
- Auto-generates sequential task IDs (1, 2, 3...)
- Creates dependency chains between subtasks
- Adds to "### Pending Tasks:" section in working memory
- Bootstraps empty task structure if no working memory exists

---

### TaskGet

Retrieves a single task by ID with full details.

**Input Schema:**
```typescript
{
  taskId: string;  // Task ID to retrieve (e.g., "1")
}
```

**Output Schema:**
```typescript
{
  success: boolean;
  task?: {
    id: string;
    subject: string;
    description: string;
    status: string;
    blockedBy: string[];  // Only shows open (non-completed) blockers
  };
  message: string;
}
```

**Example:**
```typescript
// Get task details
const result = await taskGetTool.execute({ taskId: "2" }, context);

// Returns full task with description and filtered blockers
```

**Key Behaviors:**
- Filters `blockedBy` to only show open blockers (completed blockers hidden)
- Returns full description text
- Returns null if task not found

---

### TaskList

Lists all tasks with summary information.

**Input Schema:**
```typescript
{
  status?: 'pending' | 'in_progress' | 'completed';  // Optional filter
}
```

**Output Schema:**
```typescript
{
  success: boolean;
  tasks?: Array<{
    id: string;
    subject: string;
    status: string;
    blockedBy: string[];  // Only open blockers
  }>;
  message: string;
}
```

**Example:**
```typescript
// List all pending tasks
const result = await taskListTool.execute({ status: 'pending' }, context);

// Returns array of task summaries
```

**Key Behaviors:**
- Optional status filtering
- Returns summaries (no descriptions for list view)
- Filters blockedBy to open blockers only

---

### TaskUpdate

Updates task status, fields, or deletes tasks.

**Input Schema:**
```typescript
{
  taskId: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'deleted';
  subject?: string;           // Update title
  description?: string;       // Update description
  addBlockedBy?: string[];    // Add blocking task IDs
}
```

**Output Schema:**
```typescript
{
  success: boolean;
  task?: {
    id: string;
    subject: string;
    description: string;
    status: string;
    blockedBy: string[];
  };
  message: string;
}
```

**Example:**
```typescript
// Mark task as in-progress
await taskUpdateTool.execute({
  taskId: "1",
  status: 'in_progress'
}, context);

// Mark as completed (moves to Completed section)
await taskUpdateTool.execute({
  taskId: "1",
  status: 'completed'
}, context);

// Delete a task
await taskUpdateTool.execute({
  taskId: "1",
  status: 'deleted'
}, context);

// Add blocker relationship
await taskUpdateTool.execute({
  taskId: "2",
  addBlockedBy: ["1"]  // Task 2 is blocked by Task 1
}, context);
```

**Key Behaviors:**
- Status changes move tasks between Pending/Completed sections
- `in_progress` status uses `[-]` checkbox marker
- Deletion removes task entirely from memory
- Blocker relationships tracked in task line

---

### TaskArchive

Archives completed working memory and resets for new goals. Supports both natural completion (all tasks done) and forced archival with reason tracking.

**Input Schema:**
```typescript
{
  force?: boolean;        // Archive even if not all tasks complete (default: false)
  reason?: string;        // Required context when force=true
  preserveNotes?: boolean; // Keep Notes & Context section (default: true)
}
```

**Output Schema:**
```typescript
{
  success: boolean;
  archived: boolean;
  archivePath?: string;   // Path to .agent/TASK-ARCHIVE.md
  taskCount?: number;     // Number of archived tasks
  message: string;
}
```

**Example:**
```typescript
// Natural archival (all tasks must be complete)
const result = await taskArchiveTool.execute({}, context);

// Returns:
// {
//   success: true,
//   archived: true,
//   archivePath: "/project/.agent/TASK-ARCHIVE.md",
//   taskCount: 5,
//   message: "Archived 5 tasks. Working memory cleared for new goals."
// }

// Forced archival (mid-work, requires reason)
const result = await taskArchiveTool.execute({
  force: true,
  reason: "Pivoting to new priority",
  preserveNotes: true,
}, context);
```

**Key Behaviors:**
- Validates all tasks are complete before archiving (unless `force: true`)
- Creates rolling backup in `.agent/.backups/` (keeps last 5)
- TOCTOU protection: hashes task section before and after backup, aborts on mismatch
- Appends timestamped entry to `.agent/TASK-ARCHIVE.md`
- Resets working memory to bootstrap state with archive log entry
- Preserves Notes & Context section by default

**Archival Flow:**
```
1. Fetch working memory
2. Validate completion (or force)
3. Hash task section (TOCTOU snapshot)
4. Create backup (.agent/.backups/)
5. Re-read and re-hash (TOCTOU verify)
6. Append to TASK-ARCHIVE.md
7. Clear working memory (preserve notes)
8. Save cleared memory
```

**Archive Entry Format:**
```markdown
---

## Archive — 2026-02-15T14:30:00Z

**Goal:** Implement user authentication
**Tasks:** 5 completed
**Type:** Natural completion

### Completed Tasks
- [x] [#1] Set up OAuth provider
- [x] [#2] Create login endpoint

### Notes & Context
Preserved notes from original working memory...
```

**Heartbeat Integration:**

When the heartbeat detects all tasks are complete, it emits a low-priority `all-tasks-complete` alert suggesting the agent call `TaskArchive`. The agent decides when to archive.

---

## Task Agent (Subagents)

The Task Agent provides specialized subagents for different types of work, similar to Claude Code's Task tool. Each subagent has optimized instructions and tool access.

### Usage

```typescript
// Execute via taskPlanner or direct delegation
const result = await taskAgent.generate('Find all TypeScript files', {
  requestContext: new RequestContext({ 'subagent-type': 'Explore' })
});
```

### Subagent Types

#### Bash

Command execution specialist for git, npm, file operations.

**Tools:** `bashTool`

**Best For:**
- Git operations (clone, commit, push, branch)
- Package management (npm, pnpm, yarn, pip)
- File system operations (find, grep, sed, awk)
- Process management

**Instructions:**
```
You are a Bash command execution specialist.
Your role is to execute shell commands safely and effectively.

Guidelines:
1. Safety first: Validate commands, avoid destructive operations
2. Explain commands: Briefly describe what each command does
3. Handle errors: Provide clear error messages and fixes
4. Use best practices: Prefer safe flags, quote variables
5. Chain commands: Use && for dependent, ; for independent
```

#### Research

Codebase exploration specialist for finding files and understanding architecture.

**Tools:** All core tools (same as other subagent types)

**Best For:**
- Finding files by name patterns
- Searching code for keywords/patterns
- Understanding directory structures
- Identifying naming conventions

**Instructions:**
```
You are a codebase exploration specialist.
Your role is to quickly find files, search code patterns, and understand project architecture.

Guidelines:
1. Start broad, then narrow: Begin with wide searches
2. Use efficient patterns: Prefer specific globs
3. Report findings clearly: Summarize what and where
4. Identify patterns: Note conventions and organization
5. Be thorough but fast: Balance comprehensiveness with efficiency
```

#### Plan

Software architect for designing implementation strategies.

**Tools:** `globTool`, `grepTool`, `readTool`

**Best For:**
- Breaking down complex tasks into steps
- Identifying files that need modification
- Considering edge cases and trade-offs
- Creating actionable implementation plans

**Instructions:**
```
You are a software architect and implementation planner.
Your role is to design implementation strategies, identify critical files, and consider trade-offs.

Plan Format:
## Overview
[Brief description]

## Files to Modify
- path/to/file.ts - [what changes]

## Implementation Steps
1. [Step with details]
2. [Next step]

## Considerations
- [Trade-off or risk]
```

#### general-purpose

Multi-step task handler with full tool access.

**Tools:** All core tools (read, write, edit, bash, glob, grep, web, notebook)

**Best For:**
- Complex tasks requiring multiple tools
- File reading and modification
- Web research
- Notebook editing

**Instructions:**
```
You are a general-purpose assistant for complex, multi-step tasks.

Guidelines:
1. Understand the goal: Clarify success criteria
2. Plan your approach: Think through steps
3. Use appropriate tools: Select right tool for each sub-task
4. Verify results: Check each step succeeded
5. Handle errors gracefully: Adapt if something fails
6. Report progress: Keep user informed
```

---

## Working Memory Format

Tasks are stored in the agent's working memory as markdown with a specific structure:

```markdown
### Pending Tasks:
- [ ] [#1] Fix authentication bug
  JWT tokens are not being validated correctly in the auth middleware.
  Need to update the verifyToken function in src/auth.ts.
  
- [-] [#2] Add user profile page
  Create a new profile component with editable fields.
  Blocked by design system update.

### Completed Tasks:
- [x] [#3] Setup project
  Initial project setup with TypeScript and testing framework.
  
- [x] [#4] Configure CI/CD
  GitHub Actions workflow for automated testing and deployment.
```

### Checkbox Conventions

| Checkbox | Status | Meaning |
|----------|--------|---------|
| `[ ]` | `pending` | Not started |
| `[-]` | `in_progress` | Currently working on it |
| `[x]` | `completed` | Done |

### Task ID Format

- Sequential numeric IDs: `#1`, `#2`, `#3`
- Auto-generated based on highest existing ID
- Unique within a thread/resource context

---

## Usage Examples

### Simple Task Workflow

```typescript
// 1. Create tasks
const task1 = await taskCreateTool.execute({
  subject: "Explore codebase structure",
  description: "Find all auth-related files and understand the current implementation."
}, context);

const task2 = await taskCreateTool.execute({
  subject: "Implement JWT validation",
  description: "Update verifyToken function to handle edge cases."
}, context);

// 2. Set up blocker relationship
await taskUpdateTool.execute({
  taskId: task2.taskId,
  addBlockedBy: [task1.taskId]
}, context);

// 3. Mark first task complete
await taskUpdateTool.execute({
  taskId: task1.taskId,
  status: 'completed'
}, context);

// 4. Check remaining tasks
const pending = await taskListTool.execute({ status: 'pending' }, context);
```

### AI Planning Workflow

```typescript
// Create a plan for complex work
const plan = await taskPlannerTool.execute({
  action: 'create',
  goal: 'Refactor the authentication system to use OAuth2',
  metadata: { urgency: 'high', estimatedHours: 8 }
}, context);

// Later: check plan progress
const progress = await taskPlannerTool.execute({
  action: 'get',
  planId: plan.plan.id
}, context);

console.log(progress.planSummary);  // Markdown summary
```

### Heartbeat Integration

The heartbeat workflow checks working memory for tasks needing attention:

```
Heartbeat Step: Check Working Memory
     │
     ▼
┌─────────────────────┐
│ parseAllTasks()     │──▶ Find incomplete tasks
│ from task-helpers   │
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ Categorize:         │
│ • [ ] pending       │
│ • [-] in_progress   │
│ • Blocked tasks     │
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ Alert if needed     │──▶ HEARTBEAT_ALERT
└─────────────────────┘
```

---

## File Structure

```
src/mastra/tools/
├── task-create.ts              # TaskCreate tool (AI goal decomposition)
├── task-get.ts                 # TaskGet tool
├── task-list.ts                # TaskList tool
├── task-update.ts              # TaskUpdate tool
├── task-archive.ts             # TaskArchive tool (archival & clearing)
├── task-helpers.ts             # Shared parsing & memory helpers
└── index.ts                    # Tool exports

src/mastra/agents/
└── task.ts                     # Task Agent with subagent types

.agent/
├── TASK-ARCHIVE.md             # Append-only archive of completed working memory
└── .backups/                   # Rolling backups (last 5) before clearing
    └── working-memory-*.md
├── registry.json
└── plans/{planId}/plan.json
```

### Key Relationships

| File | Depends On | Used By |
|------|------------|---------|
| `task-create.ts` | `task-helpers.ts` | Main agent |
| `task-get.ts` | `task-helpers.ts` | Main agent |
| `task-list.ts` | `task-helpers.ts` | Main agent, Heartbeat |
| `task-update.ts` | `task-helpers.ts` | Main agent |
| `task-archive.ts` | `task-helpers.ts`, `lib/task-archive.ts` | Main agent (via heartbeat suggestion) |
| `lib/task-archive.ts` | `task-helpers.ts`, `lib/config` | `task-archive.ts` tool |
| `task-planner.ts` | `task-orchestration-state.ts` | Main agent |
| `task-helpers.ts` | `../memory` | All task tools, `lib/task-archive.ts` |
| `task-orchestration-state.ts` | `fs/promises` | Task planner |
| `agents/task.ts` | `core-tools`, `memory` | Task planner (subagent execution) |

---

## See Also

- [HEARTBEAT_SYSTEM.md](HEARTBEAT_SYSTEM.md) - Proactive notifications check working memory tasks
- [MEMORY_SYSTEM.md](MEMORY_SYSTEM.md) - Working memory persistence
- [CONFIGURATION.md](CONFIGURATION.md) - Agent configuration
