# Mastra Observability Implementation Guide

This document summarizes how we track and manage token/tool usage in Mastra and documents our project's observability best practices implementation.

## Table of Contents

1. [Mastra Observability Overview](#mastra-observability-overview)
2. [Token and Tool Usage Tracking](#token-and-tool-usage-tracking)
3. [Project Implementation](#project-implementation)
4. [Best Practices Applied](#best-practices-applied)
5. [Configuration Reference](#configuration-reference)

---

## Mastra Observability Overview

Mastra's observability system is built on **OpenTelemetry** and provides specialized tracing for AI operations. Unlike traditional application tracing, it captures AI-specific context including:

- **Token usage** (input/output tokens, cache hits/misses)
- **Model parameters** (temperature, max tokens, etc.)
- **Tool execution details** (inputs, outputs, success/failure)
- **Conversation flows** (agent runs, workflow steps)

### Core Components

| Component | Purpose |
|-----------|---------|
| `Observability` | Main configuration class for tracing setup |
| `DefaultExporter` | Persists traces to storage for Mastra Studio |
| `CloudExporter` | Sends traces to Mastra Cloud (requires `MASTRA_CLOUD_ACCESS_TOKEN`) |
| `SensitiveDataFilter` | Redacts sensitive data (passwords, tokens, API keys) |
| `Span` | Individual trace segments for operations |

### Span Types

Mastra automatically creates spans for:

- **Agent Operations**: `AGENT_RUN` - Complete agent execution
- **LLM Calls**: `MODEL_GENERATION`, `MODEL_STEP`, `MODEL_CHUNK` - Model interactions
- **Tool Executions**: `TOOL_CALL`, `MCP_TOOL_CALL` - Function calls with inputs/outputs
- **Workflow Operations**: `WORKFLOW_RUN`, `WORKFLOW_STEP`, `WORKFLOW_CONDITIONAL`, etc.

---

## Token and Tool Usage Tracking

### Token Usage Capture

Token usage is automatically captured in `ModelGenerationAttributes`:

```typescript
interface ModelGenerationAttributes {
  model?: string;              // e.g., 'gpt-4', 'claude-3'
  provider?: string;           // e.g., 'openai', 'anthropic'
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
  };
  parameters?: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    // ... other params
  };
}
```

### Tool Usage Capture

Tool calls are tracked with detailed attributes:

```typescript
interface ToolCallAttributes {
  toolId?: string;
  toolType?: string;
  toolDescription?: string;
  success?: boolean;
}

interface MCPToolCallAttributes {
  toolId: string;
  mcpServer: string;
  serverVersion?: string;
  success?: boolean;
}
```

### Accessing Trace Data

Both agent `generate()` and `stream()` methods return a `traceId`:

```typescript
const result = await agent.generate("Hello");
console.log("Trace ID:", result.traceId);  // Use to lookup in Mastra Studio

// With workflows
const run = await mastra.getWorkflow("myWorkflow").createRun();
const result = await run.start({ inputData: { data: "process" } });
console.log("Trace ID:", result.traceId);
```

---

## Project Implementation

Our project implements Mastra observability in `/src/mastra/client.ts`:

### Current Configuration

```typescript
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { storage } from "./storage";

export const mastra = new Mastra({
  // ... other config
  storage,  // Required for tracing - LibSQLStore
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(),  // Persists to storage for Mastra Studio
          new CloudExporter(),    // Sends to Mastra Cloud
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),  // Redacts sensitive data
        ],
      },
    },
  }),
});
```

### Storage Backend

We use **LibSQLStore** for trace persistence (shared with Memory):

```typescript
// /src/mastra/storage.ts
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";

const DB_PATH = `file:${memoryConfig.database_url}`;

export const storage = new LibSQLStore({
  id: 'agent-storage',
  url: DB_PATH,
});
```

### Trace Capture in Gateway

Our gateway adapter captures and logs trace IDs from agent responses:

```typescript
// /src/mastra/gateway/adapter.ts
const response = await this.callAgentViaHttp(fullMessage, memoryConfig, channelContext);

// Log trace for observability
const traceId = (response as any).traceId;
if (traceId) {
  logger.info({
    traceId,
    sessionKey,
    channelType: message.channelType,
    threadId: session.threadId,
  }, 'Agent trace captured');
}
```

### Request Context for Metadata

We use `RequestContext` to pass channel metadata that gets attached to traces:

```typescript
// In gateway adapter
const requestContext = new RequestContext();
requestContext.set('channelType', message.channelType);
requestContext.set('channelId', message.channelId);
requestContext.set('threadId', message.threadId);
requestContext.set('sessionKey', sessionKey);
requestContext.set('memoryThreadId', ctxMemoryThread);
requestContext.set('memoryResource', ctxMemoryResource);

// Passed to agent via HTTP
const response = await fetch(url, {
  method: 'POST',
  body: JSON.stringify({
    messages: [{ role: 'user', content: message }],
    memory: memoryConfig,
    requestContext: {
      channelType: channelContext.channelType,
      channelId: channelContext.channelId,
      // ... other context
    },
  }),
});
```

---

## Best Practices Applied

### ✅ 1. Security - Sensitive Data Filtering

We use `SensitiveDataFilter` processor to redact sensitive information:

```typescript
spanOutputProcessors: [
  new SensitiveDataFilter(),  // Automatically redacts passwords, tokens, API keys
],
```

### ✅ 2. Structured Logging with Pino

We use PinoLogger for structured, performant logging:

```typescript
logger: new PinoLogger({
  name: 'Mastra',
  level: 'info',
}),
```

### ✅ 3. Shared Storage for Traces and Memory

Traces and memory use the same LibSQL storage backend for consistency:

```typescript
// Shared storage instance
export const storage = new LibSQLStore({
  id: 'agent-storage',
  url: DB_PATH,
});

// Used by both observability and memory
const mastra = new Mastra({
  storage,
  observability: new Observability({ /* ... */ }),
});

const sharedMemory = new Memory({
  storage,  // Same instance
  // ...
});
```

### ✅ 4. Trace ID Capture for Debugging

We capture and log trace IDs for correlation:

```typescript
const traceId = response.traceId;
if (traceId) {
  logger.info({ traceId, sessionKey }, 'Agent trace captured');
}
```

### ✅ 5. Request Context Propagation

Channel context is propagated through RequestContext for trace metadata:

```typescript
// Gateway sets context
requestContext.set('channelType', message.channelType);
requestContext.set('channelId', message.channelId);

// Middleware forwards to agent
if (body.requestContext && requestContext) {
  for (const [key, value] of Object.entries(body.requestContext)) {
    requestContext.set(key, value);
  }
}
```

### ⚠️ 6. Areas for Improvement

Based on Mastra best practices, we could enhance:

| Area | Current State | Recommendation |
|------|---------------|----------------|
| Sampling | Default (always) | Add ratio-based sampling for production |
| Custom Metadata | Basic channel context | Add user tier, request type |
| Tags | Not used | Add tags for environment, feature flags |
| External Exporters | Only CloudExporter | Consider Langfuse/Braintrust for detailed analytics |
| RequestContext Keys | Not configured | Add `requestContextKeys` for auto-extraction |

---

## Configuration Reference

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `MASTRA_CLOUD_ACCESS_TOKEN` | Enables CloudExporter to send traces to Mastra Cloud |
| `GATEWAY_API_KEY` | API key for gateway authentication |

### Agent Configuration (`agent.toml`)

Our observability-related features can be configured:

```toml
[features]
enableTracing = true  # Currently configured in code, not via config

[security]
resource_id = "interactive-agent"  # Used for memory/resource scoping
```

### Available Sampling Strategies

```typescript
// Always (default - 100%)
sampling: { type: "always" }

// Never (disable tracing)
sampling: { type: "never" }

// Ratio-based (10% sampling)
sampling: { type: "ratio", probability: 0.1 }

// Custom logic
sampling: {
  type: "custom",
  sampler: (options) => {
    if (options?.metadata?.userTier === 'premium') {
      return Math.random() < 0.5;  // 50% for premium
    }
    return Math.random() < 0.01;  // 1% default
  }
}
```

### External Exporter Options

We could add these exporters for enhanced observability:

```typescript
// Langfuse for LLM analytics
import { LangfuseExporter } from "@mastra/langfuse";
new LangfuseExporter({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
})

// Braintrust for evals + observability
import { BraintrustExporter } from "@mastra/braintrust";
new BraintrustExporter({
  apiKey: process.env.BRAINTRUST_API_KEY,
})

// OpenTelemetry for generic platforms
import { OtelExporter } from "@mastra/otel-exporter";
new OtelExporter({
  provider: { signoz: {} }  // or datadog, newrelic, etc.
})
```

---

## Viewing Traces

### Mastra Studio

1. Run `mastra dev` to start the development server
2. Navigate to the Traces panel in Mastra Studio
3. View detailed execution flows, token usage, and tool calls

### Trace Structure

Each trace contains:
- **Agent Run Span**: Root span with agent ID, instructions, available tools
- **Model Generation Spans**: LLM calls with token usage and parameters
- **Tool Call Spans**: Individual tool executions with inputs/outputs
- **Custom Metadata**: Request context values (channel, session, etc.)

---

## Related Documentation

- [Mastra Observability Docs](https://mastra.ai/docs/observability/tracing/overview)
- [OpenTelemetry GenAI Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- Project files:
  - `/src/mastra/client.ts` - Main Mastra configuration
  - `/src/mastra/storage.ts` - Storage configuration
  - `/src/mastra/gateway/adapter.ts` - Trace capture in gateway
