// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Native Flow Compiler
 *
 * Compiles Kimi flow skills (SKILL.md with Mermaid diagrams) to native Mastra workflows.
 *
 * ## Usage
 *
 * ```typescript
 * import { compileSkillToWorkflow, parseSkillFile, parseMermaidFlowchart } from './native-flow-compiler';
 *
 * // Compile a skill to a Mastra workflow
 * const workflow = compileSkillToWorkflow('path/to/skill/SKILL.md', {
 *   id: 'my-flow',
 *   name: 'My Flow',
 * });
 *
 * // Execute the workflow
 * const result = await workflow.execute({
 *   userRequest: 'Do something',
 * });
 *
 * // Or use the lower-level APIs
 * const skill = parseSkillFile('path/to/skill/SKILL.md');
 * const ast = parseMermaidFlowchart(skill.mermaidDiagram);
 * const workflow = compileFlowAst(ast, skill, { id: 'my-flow' });
 * ```
 */

// AST Types
export type {
  FlowNode,
  FlowNodeKind,
  FlowEdge,
  FlowAst,
  ParsedSkill,
  CompilationError,
  ValidationResult,
} from "./ast-types";

// Mermaid Parser
export {
  parseMermaidFlowchart,
  validateFlowAst,
  getExecutionPath,
} from "./mermaid-parser";

// Skill Parser
export {
  parseSkillFile,
  parseSkillContent,
  isFlowSkill,
  getFlowMetadata,
} from "./skill-parser";

// Workflow Compiler
export {
  compileSkillToWorkflow,
  compileParsedSkill,
  compileFlowAst,
  createSimpleWorkflow,
  type CompileOptions,
  type RetryConfig,
  type OnFinishParams,
  type OnErrorParams,
} from "./workflow-compiler";
export {
  workflowStateSchema,
  workflowInputSchema,
  workflowOutputSchema,
  taskOutputSchema,
} from "./workflow-compiler";

// Error Types (Mastra best practice: domain-specific errors)
export {
  CompiledWorkflowError,
  TaskExecutionError,
  LoopExecutionError,
  DecisionExecutionError,
  WorkflowCompilationError,
} from "./errors";

// Loop detection exports (for testing)
export {
  detectLoops,
  extractLoopInfo,
  findPathNodes,
  topologicalSortWithLoops,
  type LoopInfo,
} from "./workflow-compiler";
