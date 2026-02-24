// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { resolve } from "node:path";
import { Agent } from "@mastra/core/agent";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";
import {
  BatchPartsProcessor,
  PIIDetector,
  PromptInjectionDetector,
  SkillsProcessor,
  UnicodeNormalizer,
} from "@mastra/core/processors";
// REMOVED: TokenLimiterProcessor - compaction replaced by Observational Memory
import { createAnswerRelevancyScorer, createToxicityScorer } from "@mastra/evals/scorers/prebuilt";
import { fastembed } from "@mastra/fastembed";
import { Memory } from "@mastra/memory";
import { loadFlows, toWorkflowsRecord } from "../flows";
import { AGENT_DIR, getFlowsConfig, getLoopConfig, getMemoryConfig, loadAgentConfig } from "../lib/config";
// REMOVED: getCompactionInstructions - replaced by Observational Memory
import { getHeartbeatInstructions } from "../lib/instructions/heartbeat";
import { getPatternInstructions } from "../lib/loop-patterns";
import { loadSoulFiles } from "../lib/parsers";
import { mcpClient } from "../mcp_client";
import { sharedMemory } from "../memory";
import { getAdaptationProcessor } from "../processors/adaptation-processor";
import { AdversarialPatternDetector } from "../processors/adversarial-detector";
import { SecretMaskProcessor } from "../processors/secret-mask-processor";
import { SecretSanitizerProcessor } from "../processors/secret-sanitizer-processor";
// REMOVED: TimeCompactionProcessor and TokenCompactionProcessor - replaced by Observational Memory
import { getUserPreferencesProcessor } from "../processors/user-preferences";
import { storage, vector } from "../storage";
import { tools } from "../tools";
import { dynamicFlowRouterWorkflow } from "../workflows/dynamic-flow-router";
import { nativeFlowExecutionWorkflow } from "../workflows/native-flow-execution-workflow";
import { workspace } from "../workspace";

/**
 * Load and merge tools (MCP + local)
 *
 * Loads MCP tools from the MCPClient, generates skill tools from metadata,
 * and merges them with local tools.
 * Precedence: MCP < Skill < Local (local tools can override skills)
 *
 * This is an async operation that runs once when the agent is created.
 */
async function getMergedTools(): Promise<Record<string, any>> {
  // 1. Get MCP tools from the single shared client
  const mcpTools = await mcpClient.listTools();

  // 2. Build local tools map
  const localToolsMap = tools.reduce(
    (acc, tool) => {
      acc[tool.id] = tool;
      return acc;
    },
    {} as Record<string, any>,
  );

  const mcpCount = Object.keys(mcpTools).length;
  const localCount = Object.keys(localToolsMap).length;
  console.log(`[interactive-agent] Loaded ${mcpCount} MCP tool(s), ${localCount} local tool(s)`);

  // 5. Merge with precedence: MCP < Skill < Flow < Local
  // Local tools have highest precedence (core functionality)
  return {
    ...mcpTools, // Lowest precedence
    ...localToolsMap, // Highest precedence (can override skills)
  };
}

// Load agent config for models
const agentConfig = await loadAgentConfig(); //added static config so we don't have to pass these configuration options via the gateway over http.
const defaultModel = agentConfig.models?.default ?? "zai-coding-plan/glm-4.7";
const scorerModel = agentConfig.models?.scorer_model ?? "zai-coding-plan/glm-4.5-air";
// Moderation model for safety processors (defaults to GPT-OSS Safeguard)
const moderationModel = agentConfig.models?.moderation ?? "openrouter/openai/gpt-oss-safeguard-20b";
// Processors use specific config if set, otherwise fall back to moderation model
const promptInjectionModel = agentConfig.models?.prompt_injection ?? moderationModel;
const piiDetectionModel = agentConfig.models?.pii_detection ?? moderationModel;
const enablePiiDetection = agentConfig.security?.enablePiiDetection ?? false;
const enablePromptInjectionDetection = agentConfig.security?.enablePromptInjectionDetection ?? false;
const enableAdversarialPatternDetection = agentConfig.security?.enableAdversarialPatternDetection ?? false;
const enableUnicodeNormalization = agentConfig.security?.enableUnicodeNormalization ?? false;
const enableBatchPartsProcessor = agentConfig.security?.enableBatchPartsProcessor ?? false;
const enableSecretProtection = agentConfig.security?.enableSecretProtection ?? true;
const secretMaskProcessor = enableSecretProtection ? new SecretMaskProcessor({ debug: false }) : null;
const secretSanitizerProcessor = enableSecretProtection ? new SecretSanitizerProcessor({ debug: false }) : null;
// REMOVED: compaction config variables - replaced by Observational Memory

// Load flows from FLOW.md files
const flowsConfig = await getFlowsConfig();
const flowsResult = await loadFlows({
  paths: flowsConfig.paths,
  basePath: resolve(AGENT_DIR, ".."),
  autoCompile: flowsConfig.auto_compile,
});
const flowWorkflows = toWorkflowsRecord(flowsResult.flows);
console.log(`[interactive-agent] Loaded ${flowsResult.flows.size} flow(s)`);
if (flowsResult.errors.length > 0) {
  console.warn(`[interactive-agent] Flow errors: ${flowsResult.errors.length}`);
}

const piiDetector = new PIIDetector({
  model: piiDetectionModel,
  threshold: 0.6,
  strategy: "redact",
  redactionMethod: "mask",
  detectionTypes: ["email", "phone", "credit-card", "password"],
  instructions: "Detect and mask personally identifiable information, system environment variables, and API keys.",
});

const batchPartsProcessor = new BatchPartsProcessor({
  batchSize: 5,
  maxWaitTime: 100,
  emitOnNonText: true,
});

const dynamicOutputProcessors = [];

if (enableSecretProtection && secretSanitizerProcessor) {
  dynamicOutputProcessors.push(secretSanitizerProcessor);
}
if (enablePiiDetection) {
  dynamicOutputProcessors.push(piiDetector);
}
if (enableBatchPartsProcessor) {
  dynamicOutputProcessors.push(batchPartsProcessor);
}

// Security processors - respect feature flags from agent.toml
const promptInjectionProcessor = enablePromptInjectionDetection
  ? new PromptInjectionDetector({
      model: promptInjectionModel,
      threshold: 0.8,
      strategy: "block",
      detectionTypes: ["injection", "jailbreak", "system-override"],
    })
  : null;

const adversarialPatternDetector = enableAdversarialPatternDetection ? new AdversarialPatternDetector() : null;

const unicodeNormalizer = enableUnicodeNormalization ? new UnicodeNormalizer() : null;

/**
 * Build context processors based on strategy
 *
 * Note: These processors run AFTER memory processors (MessageHistory, SemanticRecall)
 * according to Mastra's processor execution order:
 * [Memory Processors] → [Your inputProcessors]
 */

// Load memory configuration from agent.toml
const memoryConfig = await getMemoryConfig();
console.log(
  `[interactive-agent] Memory config from agent.toml: lastMessages=${memoryConfig.last_messages}, topK=${memoryConfig.semantic_recall_top_k}, messageRange=${memoryConfig.semantic_recall_message_range}`,
);

// REMOVED: Compaction logging - replaced by Observational Memory

// Load loop pattern config
const loopConfig = await getLoopConfig();
console.log(`[interactive-agent] Loop pattern: ${loopConfig.pattern}`);

// REMOVED: buildContextProcessors function and contextProcessors - replaced by Observational Memory

export const interactiveAgent = new Agent({
  id: "interactive-agent",
  name: "Interactive Agent",
  model: defaultModel,
  workspace,

  instructions: async ({ requestContext }) => {
    // Load soul configuration files
    const { identity, soul, user } = await loadSoulFiles();
    // console.log(`[interactive-agent] Loaded soul files: identity=${identity.length} chars, soul=${soul.length} chars, user=${user.length} chars`);
    // console.log(`[interactive-agent] Identity: ${identity}`);
    // console.log(`[interactive-agent] Soul: ${soul}`);
    // console.log(`[interactive-agent] User: ${user}`);

    const channelType = requestContext?.get("channelType");
    const channelId = requestContext?.get("channelId");
    const alertType = requestContext?.get("alertType");

    if (channelId) {
      console.log(`[interactive-agent] Channel ID: ${channelId}, Channel Type: ${channelType}`);
    }

    // Build channel context section if available
    const channelContextSection = channelId
      ? `
    ## Channel Context
    - **Channel Type**: ${channelType}
    - **Channel ID**: ${channelId || "unknown"}
    - **Session**: ${requestContext?.get("sessionKey") || "unknown"}

    Use this context when you need to know where responses will be sent or to tailor your communication style for the channel.
    `
      : "";

    // Inject heartbeat instructions when this is a heartbeat alert
    const heartbeatSection = alertType === "heartbeat" ? getHeartbeatInstructions() : "";

    return `
    ## Identity
    ${identity}

    ## Soul
    ${soul}

    ## User
    ${user}

    ${channelContextSection}

    ${getPatternInstructions(loopConfig.pattern)}

    ${heartbeatSection}
  `;
  },
  memory: sharedMemory,
  workflows: {
    nativeFlowExecutionWorkflow,
    dynamicFlowRouterWorkflow,
    ...flowWorkflows, // Spread loaded flow workflows
  },
  tools: await getMergedTools(),
  inputProcessors: [
    // Security processors (respect feature flags from agent.toml)
    // 0. Mask secrets before any other processor can see or log them
    ...(secretMaskProcessor ? [secretMaskProcessor] : []),
    // 1. Normalize Unicode text (zero-cost, deterministic)
    ...(unicodeNormalizer ? [unicodeNormalizer] : []),
    // 2. Fast regex-based adversarial pattern detection (zero-cost, zero-latency)
    ...(adversarialPatternDetector ? [adversarialPatternDetector] : []),
    // 3. LLM-based prompt injection detection (adds ~1 LLM call per message)
    ...(promptInjectionProcessor ? [promptInjectionProcessor] : []),
    // 4. Context management: REMOVED - now handled by Observational Memory in memory.ts
    // 5. Skills loading
    new SkillsProcessor({ workspace }),
    // 6. User preferences
    getUserPreferencesProcessor(),
    // 7. Adaptation (learned patterns + coaching)
    getAdaptationProcessor(),
    // Log skills info
    {
      id: "skills-logger",
      name: "Skills Logger",
      processInputStep: async ({ messageList, tools }) => {
        console.log("[skills] SkillsProcessor active, workspace skills:", workspace.skills);
        return { messageList, tools };
      },
    },
  ],
  outputProcessors: dynamicOutputProcessors,
  scorers: {
    relevancy: {
      scorer: createAnswerRelevancyScorer({ model: scorerModel }),
      sampling: { type: "ratio", rate: 0.5 },
    },
    safety: {
      scorer: createToxicityScorer({ model: scorerModel }),
      sampling: { type: "ratio", rate: 1 },
    },
  },
});
