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
  CompilationError,
  FlowAst,
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  ParsedSkill,
  ValidationResult,
} from "./ast-types";
// Error Types (Mastra best practice: domain-specific errors)
export {
  CompiledWorkflowError,
  DecisionExecutionError,
  LoopExecutionError,
  TaskExecutionError,
  WorkflowCompilationError,
} from "./errors";
// Mermaid Parser
export {
  getExecutionPath,
  parseMermaidFlowchart,
  validateFlowAst,
} from "./mermaid-parser";
// Skill Parser
export {
  getFlowMetadata,
  isFlowSkill,
  parseSkillContent,
  parseSkillFile,
} from "./skill-parser";
// Workflow Compiler
// Loop detection exports (for testing)
export {
  type CompileOptions,
  compileFlowAst,
  compileParsedSkill,
  compileSkillToWorkflow,
  createSimpleWorkflow,
  detectLoops,
  extractLoopInfo,
  findPathNodes,
  type LoopInfo,
  type OnErrorParams,
  type OnFinishParams,
  type RetryConfig,
  taskOutputSchema,
  topologicalSortWithLoops,
  workflowInputSchema,
  workflowOutputSchema,
  workflowStateSchema,
} from "./workflow-compiler";
