# Native Flow Compiler

Compiles Kimi flow skills (SKILL.md with Mermaid diagrams) to native Mastra workflows.

## Overview

This compiler provides **Pattern A** execution for Kimi flow skills - deterministic state machine execution that mirrors Kimi's flow runner but runs natively in Mastra with full observability.

## Architecture

```
SKILL.md → Skill Parser → Mermaid Parser → Flow AST → Workflow Compiler → Mastra Workflow
```

## Components

### 1. Skill Parser (`skill-parser.ts`)
Extracts frontmatter metadata and Mermaid diagram from SKILL.md files.

```typescript
import { parseSkillFile, isFlowSkill } from './skill-parser';

const skill = parseSkillFile('.kimi/skills/codex-orchestrator/SKILL.md');
console.log(skill.frontmatter.name);      // "Codex Orchestrator"
console.log(skill.mermaidDiagram);         // Mermaid flowchart
```

### 2. Mermaid Parser (`mermaid-parser.ts`)
Parses Mermaid flowchart syntax into a typed AST.

```typescript
import { parseMermaidFlowchart, validateFlowAst } from './mermaid-parser';

const ast = parseMermaidFlowchart(skill.mermaidDiagram);
// ast.nodes: Map of node ID → FlowNode
// ast.edges: Map of source ID → FlowEdge[]
// ast.beginNode: Entry point node ID
// ast.endNode: Exit point node ID

const validation = validateFlowAst(ast);
if (!validation.valid) {
  console.error(validation.errors);
}
```

### 3. Workflow Compiler (`workflow-compiler.ts`)
Transforms the AST into a native Mastra workflow using Mastra v1.x patterns.

```typescript
import { compileSkillToWorkflow, compileFlowAst } from './workflow-compiler';

// Compile from skill file
const workflow = compileSkillToWorkflow(skillPath, {
  id: 'my-flow',
  name: 'My Flow',
  description: 'Description',
});

// Or compile from parsed AST
const workflow = compileFlowAst(ast, skill, {
  id: 'my-flow',
  name: 'My Flow',
});

// Register with Mastra and execute using v1.x pattern
const run = await workflow.createRun();
const result = await run.start({
  inputData: { userRequest: 'Do something', context: {} },
});
```

### 4. Native Flow Executor (`native-flow-executor.ts`)
High-level executor with suspend/resume support using Mastra v1.x `createRun()` pattern.

```typescript
import { NativeFlowExecutor, executeNativeFlow } from '../native-flow-executor';

// Using the executor class
const executor = new NativeFlowExecutor({
  skillPath: '.kimi/skills/codex-orchestrator/SKILL.md',
  mastra,
  debug: true,
});
await executor.initialize();

// Execute using Mastra v1.x pattern
const result = await executor.execute('Create a React component');

// Handle all Mastra status types
switch (result.status) {
  case 'success':
    console.log('Completed:', result.result);
    break;
  case 'suspended':
    // Handle user decision
    console.log('Question:', result.suspension?.question);
    console.log('Options:', result.suspension?.options);
    const resumeResult = await executor.resume(
      result.suspension!.executionId,
      'Yes'  // User's choice
    );
    break;
  case 'failed':
    console.error('Failed:', result.error);
    break;
  case 'error':
    console.error('Error:', result.error);
    break;
}

// Or use the convenience function
const result = await executeNativeFlow(skillPath, userRequest, mastra);

// Streaming execution
const { stream, result: finalResult } = await executor.stream(userRequest);
for await (const chunk of stream) {
  console.log(chunk);
}
```

### 5. Native Flow Tool (`tools/flow/native-flow-tool.ts`)
Mastra tool for agent integration.

```typescript
import { nativeFlowTool } from '../tools/flow/native-flow-tool';

// The tool is automatically registered with the interactive agent
// Agents can call it like:
nativeFlow({
  flowName: 'codex-orchestrator',
  userRequest: 'Build an auth system',
});
```

## Node Types

The compiler maps Mermaid nodes to Mastra steps:

| Mermaid Syntax | Kind | Mastra Step |
|---------------|------|-------------|
| `([BEGIN])` | begin | Entry point step |
| `([END])` | end | Final result step |
| `[Task]` | task | Agent execution step |
| `{Decision?}` | decision | Suspend step for user choice |

## Validation

The compiler validates flows for:
- **Missing BEGIN/END**: Exactly one of each required
- **Unlabeled decision edges**: Decision nodes with multiple exits must have labeled edges
- **Duplicate edge labels**: No duplicate labels on decision branches
- **Unreachable nodes**: All nodes must be reachable from BEGIN

## Suspend/Resume Pattern (Mastra v1.x)

Decision nodes suspend execution for user input using Mastra's native suspend/resume:

```typescript
// Decision step with suspendSchema and resumeSchema
const decisionStep = createStep({
  id: 'decision',
  suspendSchema: z.object({
    decisionNode: z.string(),
    question: z.string(),
    options: z.array(z.object({ value: z.string(), label: z.string() })),
  }),
  resumeSchema: z.object({
    choice: z.string(),
  }),
  execute: async ({ suspend, resumeData }) => {
    // First execution: suspend for user input
    if (!resumeData) {
      await suspend({
        decisionNode: 'decision',
        question: 'Complex?',
        options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }],
      });
      return {};
    }
    
    // Resumed execution: resumeData contains user's choice
    return { choice: resumeData.choice };
  },
});

// Execute and handle suspension
const run = await workflow.createRun();
const result = await run.start({ inputData: {...} });

if (result.status === 'suspended') {
  // Get suspend payload from the suspended step
  const suspendedStep = result.suspended?.[0];
  const suspendPayload = result.steps[suspendedStep]?.suspendPayload;
  
  // Resume with user's choice
  const resumeResult = await run.resume({
    resumeData: { choice: 'Yes' },
  });
}
```

## Workflow State Management

The compiler uses Mastra's `stateSchema` for shared workflow state:

```typescript
// Define state schema
const workflowStateSchema = z.object({
  executionPath: z.array(z.string()),
  decisions: z.array(z.object({ node: z.string(), choice: z.string() })),
  context: z.record(z.any()),
  userRequest: z.string(),
});

// Create workflow with state
const workflow = createWorkflow({
  id: 'my-flow',
  stateSchema: workflowStateSchema,
  // ...
});

// Steps can read and update state
const step = createStep({
  stateSchema: workflowStateSchema,
  execute: async ({ state, setState }) => {
    // Read from state
    console.log(state.executionPath);
    
    // Update state (persists across suspend/resume)
    await setState({
      ...state,
      executionPath: [...state.executionPath, stepId],
    });
    
    return { result: 'done' };
  },
});
```

## Control Flow

The compiler uses Mastra's control flow methods:

```typescript
// Sequential execution
workflow
  .then(step1)
  .then(step2)
  .then(step3)
  .commit();

// Conditional branches (for decision nodes)
workflow
  .then(decisionStep)
  .branch([
    [async ({ inputData }) => inputData.choice === 'Yes', yesStep],
    [async ({ inputData }) => inputData.choice === 'No', noStep],
  ])
  .commit();
```

## Benefits Over CLI Mode (kimiFlowTool)

| Feature | kimiFlowTool (Pattern B) | nativeFlow (Pattern A) |
|---------|-------------------------|------------------------|
| Studio Integration | ❌ None | ✅ Full visual graph |
| Observability | ❌ Process stdout | ✅ Step-level tracing |
| State Persistence | ❌ In-memory only | ✅ Mastra storage |
| Error Handling | ❌ Process errors | ✅ Typed errors |
| Suspend/Resume | ⚠️ Manual parsing | ✅ Native support |
| CLI Dependency | ✅ Requires Kimi CLI | ✅ No external deps |

## Example Usage

```typescript
import { 
  parseSkillFile, 
  parseMermaidFlowchart, 
  validateFlowAst,
  compileFlowAst 
} from './native-flow-compiler';

// 1. Parse and validate a skill
const skill = parseSkillFile('.kimi/skills/my-flow/SKILL.md');
const ast = parseMermaidFlowchart(skill.mermaidDiagram);
const validation = validateFlowAst(ast);

if (!validation.valid) {
  console.error('Flow errors:', validation.errors);
  process.exit(1);
}

// 2. Compile to Mastra workflow
const workflow = compileFlowAst(ast, skill, {
  id: 'my-flow',
  name: 'My Flow',
});

// 3. Execute using Mastra v1.x pattern
const run = await workflow.createRun();
const result = await run.start({
  inputData: {
    userRequest: 'Do something',
    context: { extra: 'data' },
  },
  initialState: {
    executionPath: [],
    decisions: [],
    context: {},
    userRequest: 'Do something',
  },
});

// 4. Handle result
if (result.status === 'success') {
  console.log('Result:', result.result);
  console.log('Execution path:', result.steps);
}
```

## Testing

Run the test suite:

```bash
npx vitest run src/mastra/workflows/native-flow-compiler/__tests__
```

## Mastra v1.x Migration Notes

Key changes from previous implementation:

1. **Execution Pattern**: Changed from `workflow.execute()` to `createRun()` → `run.start()`
2. **Step Creation**: Use `createStep()` instead of `new Step()`
3. **State Management**: Use `stateSchema` + `setState()` / `state` instead of manual state passing
4. **Suspend/Resume**: Use `suspendSchema` / `resumeSchema` with `suspendData` access
5. **Result Handling**: Check for `success`, `failed`, `suspended`, `tripwire`, `paused` statuses
6. **Control Flow**: Use `.branch()` for decision nodes, `.then()` for sequential flow

## Future Enhancements

1. **Parallel Execution**: Support for `.parallel()` branches in Mermaid
2. **Custom Step Handlers**: Plugin system for custom node types
3. **Visual Editor**: Generate Mermaid from workflow definitions
4. **Migration Tool**: Convert existing Goose flows to Kimi format
