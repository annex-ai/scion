# Configurable Loop Patterns

The agent's orchestration behavior is configurable via the `[loop]` section in `.agent/agent.toml`. Changing the `pattern` value switches how the agent approaches tasks — from self-directed task management to research loops to multi-agent coordination.

## Configuration

```toml
[loop]
# Options: kimi-loop | task-based | ralph-loop | agent-swarm | agent-team
pattern = "kimi-loop"
```

No restart required beyond reloading the agent. The pattern is read at agent initialization and injected into the system prompt via `instructions()`.

## How It Works

```
agent.toml → getLoopConfig() → getPatternInstructions(pattern) → instructions()
```

Each pattern is a module in `src/mastra/lib/loop-patterns/` that exports a `get*Instructions()` function returning orchestration instructions as a string. A switch in `src/mastra/lib/loop-patterns/index.ts` selects the right module based on the config value. The agent's `instructions()` function composes the final prompt from identity files + channel context + pattern instructions.

## Patterns

### kimi-loop (default)

Plan-Execute-Verify loop. The agent decomposes requests into tasks, executes them one at a time, then verifies the results.

**Phases:** Plan → Execute → Verify

**How it works:**
- Plan: Analyze request, call `TaskCreate()` to decompose goal into tasks
- Execute: Process tasks one at a time using `TaskList()` and `TaskUpdate()`
- Verify: Review completed tasks, run verification, notify user

**Control signals:** `CONTINUE` (more work) or `STOP` (all done)

**Self-correction:** Retries on errors, creates recovery tasks, replans if stuck.

**Best for:** General-purpose task execution, coding tasks, multi-step problems.

### task-based

Self-directed task loop. The agent decomposes requests into subtasks, executes them sequentially, and signals completion.

**Phases:** Planning → Execution → Finalization

**How it works:**
- Iteration 0: Analyze request, create subtasks via TaskCreate
- Iterations 1-N: Execute current task, update status, advance to next
- Final: Summarize what was accomplished, signal STOP

**Best for:** Code tasks, multi-step problems, anything requiring structured decomposition.

### ralph-loop

Research loop with three distinct phases. The agent gathers sources, analyzes findings, then synthesizes a response.

**Phases:** Gather → Analyze → Synthesize

**How it works:**
- Gather: Use search/fetch tools to collect sources, track relevance
- Analyze: Cross-reference claims, identify consensus/contradictions/gaps
- Synthesize: Produce cited response, signal STOP

**Best for:** Research questions, information gathering, comparative analysis.

### agent-swarm

Coordinator pattern. The main agent delegates sub-tasks to specialist ephemeral agents via the `delegate-to-agent` tool, collects results, and synthesizes.

**Phases:** Plan → Delegate → Collect → Synthesize

**How it works:**
- Plan: Decompose task into specialist sub-tasks
- Delegate: Send each sub-task to a specialist via `delegate-to-agent`
- Collect: Review specialist outputs, re-delegate if insufficient
- Synthesize: Merge results into final response

**Best for:** Tasks requiring diverse expertise (code review + security audit + docs).

### agent-team

Structured team coordination with a lead agent and members. Unlike swarm (fire-and-forget), team members share context and iterate.

**Phases:** Staff → Plan → Handoff → Review → Deliver

**How it works:**
- Staff: Define team roles and shared context
- Plan: Create work plan with assignments and dependencies
- Handoff: Assign tasks to members via `handoff-to-agent`
- Review: Evaluate outputs, request revisions if needed
- Deliver: Compile team work into final deliverable

**Best for:** Complex projects with interdependent components (API + frontend + tests).

## File Structure

```
src/mastra/lib/loop-patterns/
  index.ts              # Switch: pattern string → instructions string
  kimi-loop.ts          # Default pattern (plan → execute → verify)
  task-based.ts         # Task decomposition pattern
  ralph-loop.ts         # Research loop
  agent-swarm.ts        # Coordinator + delegation
  agent-team.ts         # Lead + members + handoffs

src/mastra/tools/
  delegate-agent.ts     # Ephemeral specialist agent (agent-swarm)
  handoff-agent.ts      # Team member agent with shared context (agent-team)

src/mastra/lib/config/
  agent-config.ts       # [loop] schema (loopSchema) + getLoopConfig()
  index.ts              # Exports getLoopConfig

src/mastra/agents/
  interactive.ts        # instructions() calls getPatternInstructions()
```

## Adding a New Pattern

1. Create `src/mastra/lib/loop-patterns/my-pattern.ts` exporting `getMyPatternInstructions(): string`
2. Add a case to the switch in `src/mastra/lib/loop-patterns/index.ts`
3. Add the value to the `pattern` enum in `loopSchema` in `agent-config.ts`
4. Set `pattern = "my-pattern"` in `agent.toml`
