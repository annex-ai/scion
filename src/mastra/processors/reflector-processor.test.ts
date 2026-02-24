// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { MastraDBMessage, MessageList } from "@mastra/core/agent";
import { reflectorAgent } from "../agents/reflector";
import { ReflectorProcessor } from "./reflector-processor";
import type { ReflectorAnalysis } from "./reflector-processor";

// Helper to create mock messages
function createMessage(
  id: string,
  role: "user" | "assistant" | "system",
  content: string | Record<string, any>,
): MastraDBMessage {
  return {
    id,
    role,
    content,
    createdAt: new Date(),
  } as MastraDBMessage;
}

function createMockMessageList(latestUserContent?: string): MessageList {
  return {
    messages: [],
    addMessage: mock(() => {}),
    addMessages: mock(() => {}),
    getMessages: mock(() => []),
    toArray: mock(() => []),
    getLatestUserContent: mock(() => latestUserContent ?? null),
  } as unknown as MessageList;
}

describe("ReflectorProcessor", () => {
  let processor: ReflectorProcessor;

  beforeEach(() => {
    processor = new ReflectorProcessor();
  });

  test("should have correct id and name", () => {
    expect(processor.id).toBe("reflector-processor");
    expect(processor.name).toBe("Reflector");
  });

  test("should skip when no assistant message is present", async () => {
    const messages: MastraDBMessage[] = [createMessage("1", "user", "Hello"), createMessage("2", "user", "World")];

    const result = await processor.processOutputResult({
      messages,
      messageList: createMockMessageList(),
      abort: () => {
        throw new Error("Aborted");
      },
      retryCount: 0,
      state: {},
    });

    // Should return unchanged
    expect(result).toEqual(messages);
  });

  test("should skip very short assistant messages", async () => {
    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "Hi"),
      createMessage("2", "assistant", "Hello!"), // < 50 chars
    ];

    const result = await processor.processOutputResult({
      messages,
      messageList: createMockMessageList(),
      abort: () => {
        throw new Error("Aborted");
      },
      retryCount: 0,
      state: {},
    });

    expect(result).toEqual(messages);
  });

  test("should skip tool-call-only assistant messages", async () => {
    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "Run the task"),
      createMessage("2", "assistant", {
        parts: [
          { type: "tool-invocation", toolName: "test-tool", args: {} },
          { type: "tool-result", result: "done" },
        ],
      }),
    ];

    const result = await processor.processOutputResult({
      messages,
      messageList: createMockMessageList(),
      abort: () => {
        throw new Error("Aborted");
      },
      retryCount: 0,
      state: {},
    });

    expect(result).toEqual(messages);
  });

  test("should skip when no user query found before assistant message", async () => {
    const messages: MastraDBMessage[] = [
      createMessage(
        "1",
        "assistant",
        "This is a substantial response that is longer than fifty characters to pass the length check.",
      ),
    ];

    const result = await processor.processOutputResult({
      messages,
      messageList: createMockMessageList(),
      abort: () => {
        throw new Error("Aborted");
      },
      retryCount: 0,
      state: {},
    });

    expect(result).toEqual(messages);
  });

  test("should return messages unchanged on error (non-blocking)", async () => {
    // Mock the agent's generate to throw
    const originalGenerate = reflectorAgent.generate;
    reflectorAgent.generate = mock(async () => {
      throw new Error("Model resolution failed");
    }) as any;

    const messages: MastraDBMessage[] = [
      createMessage("1", "system", "You are a helpful assistant"),
      createMessage("2", "user", "What is the meaning of life?"),
      createMessage(
        "3",
        "assistant",
        "The meaning of life is a philosophical question that has been debated for centuries. Here are some perspectives...",
      ),
    ];

    const mockMessageList = createMockMessageList();
    (mockMessageList as any).getLatestUserContent = mock(() => "What is the meaning of life?");

    const result = await processor.processOutputResult({
      messages,
      messageList: mockMessageList,
      abort: () => {
        throw new Error("Aborted");
      },
      retryCount: 0,
      state: {},
    });

    // On failure, should return messages unchanged (non-blocking)
    expect(result.length).toBe(messages.length);
    expect(result[0].role).toBe("system");
    expect(result[1].role).toBe("user");
    expect(result[2].role).toBe("assistant");

    // Restore
    reflectorAgent.generate = originalGenerate;
  });

  test("should handle string and object content formats for text extraction", () => {
    const extractTextContent = (processor as any).extractTextContent.bind(processor);

    // String content
    expect(extractTextContent(createMessage("1", "user", "Hello world"))).toBe("Hello world");

    // Object content with content field
    expect(extractTextContent(createMessage("2", "user", { content: "Nested content" }))).toBe("Nested content");

    // Parts array
    expect(
      extractTextContent(
        createMessage("3", "user", {
          parts: [
            { type: "text", text: "Part 1" },
            { type: "image", url: "http://example.com/img.png" },
            { type: "text", text: "Part 2" },
          ],
        }),
      ),
    ).toBe("Part 1\nPart 2");

    // Empty/null content
    expect(extractTextContent(createMessage("4", "user", null as any))).toBe("");
  });

  test("should correctly identify tool-call-only messages", () => {
    const isToolCallOnly = (processor as any).isToolCallOnly.bind(processor);

    // Tool-call only (no text parts)
    expect(
      isToolCallOnly(
        createMessage("1", "assistant", {
          parts: [
            { type: "tool-invocation", toolName: "test", args: {} },
            { type: "tool-result", result: "done" },
          ],
        }),
      ),
    ).toBe(true);

    // Has text parts alongside tool calls
    expect(
      isToolCallOnly(
        createMessage("2", "assistant", {
          parts: [
            { type: "text", text: "Let me check that for you." },
            { type: "tool-invocation", toolName: "test", args: {} },
          ],
        }),
      ),
    ).toBe(false);

    // String content (not tool-call-only)
    expect(isToolCallOnly(createMessage("3", "assistant", "Hello world"))).toBe(false);
  });

  test("should find last assistant index correctly", () => {
    const findLastAssistantIndex = (processor as any).findLastAssistantIndex.bind(processor);

    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "Hello"),
      createMessage("2", "assistant", "Hi"),
      createMessage("3", "user", "How are you?"),
      createMessage("4", "assistant", "Good!"),
      createMessage("5", "user", "Great"),
    ];

    expect(findLastAssistantIndex(messages)).toBe(3);

    // No assistant messages
    const userOnly: MastraDBMessage[] = [createMessage("1", "user", "Hello"), createMessage("2", "user", "World")];

    expect(findLastAssistantIndex(userOnly)).toBe(-1);
  });

  test("should extract reasoning content from thinking parts", () => {
    const extractReasoningContent = (processor as any).extractReasoningContent.bind(processor);

    const msg = createMessage("1", "assistant", {
      parts: [
        { type: "thinking", text: "Let me think about this..." },
        { type: "text", text: "Here is my answer" },
        { type: "reasoning", text: "Based on the context..." },
      ],
    });

    expect(extractReasoningContent(msg)).toBe("Let me think about this...\nBased on the context...");

    // No reasoning parts
    const noReasoning = createMessage("2", "assistant", "Just text");
    expect(extractReasoningContent(noReasoning)).toBe("");
  });
});

// ============================================================================
// Metadata attachment (processOutputResult with mocked LLM)
// ============================================================================

describe("ReflectorProcessor metadata attachment", () => {
  const fakeAnalysis: ReflectorAnalysis = {
    patterns: [
      {
        type: "attention_signal",
        description: "User references deployment config",
        evidence: "mentioned nginx.conf",
        confidence: 0.85,
      },
      {
        type: "noise_pattern",
        description: "Greeting pleasantries",
        evidence: "Hi, how are you",
        confidence: 0.6,
      },
    ],
    insights: {
      whatWorked: "Specific file references helped focus the answer",
      whatToRemember: "User prefers concise answers with code examples",
      curationSuggestions: ["Prioritize messages containing file paths", "Filter out single-word acknowledgments"],
    },
  };

  let originalGenerate: typeof reflectorAgent.generate;

  beforeEach(() => {
    originalGenerate = reflectorAgent.generate;
  });

  function mockAgentGenerate(impl: (...args: any[]) => any) {
    reflectorAgent.generate = mock(impl) as any;
  }

  function restoreAgent() {
    reflectorAgent.generate = originalGenerate;
  }

  function callArgs(): any {
    const ml = createMockMessageList();
    (ml as any).getLatestUserContent = mock(() => "How do I configure nginx for reverse proxy?");
    return {
      messageList: ml,
      abort: () => {
        throw new Error("Aborted");
      },
      retryCount: 0,
      state: {},
    };
  }

  test("attaches reflectorAnalysis to string content assistant message", async () => {
    mockAgentGenerate(async () => ({ object: fakeAnalysis }));
    const processor = new ReflectorProcessor();

    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "How do I configure nginx for reverse proxy?"),
      createMessage(
        "2",
        "assistant",
        "To configure nginx as a reverse proxy, edit your nginx.conf file and add a location block with proxy_pass directive.",
      ),
    ];

    const result = await processor.processOutputResult({
      ...callArgs(),
      messages,
    });

    expect(result.length).toBe(2);
    const assistantContent = result[1].content as any;
    // String content should be converted to V2 format
    expect(assistantContent.format).toBe(2);
    expect(assistantContent.parts).toBeInstanceOf(Array);
    expect(assistantContent.metadata.reflectorAnalysis).toEqual(fakeAnalysis);
    expect(typeof assistantContent.metadata.reflectorTimestamp).toBe("string");

    restoreAgent();
  });

  test("attaches reflectorAnalysis to object content assistant message", async () => {
    mockAgentGenerate(async () => ({ object: fakeAnalysis }));
    const processor = new ReflectorProcessor();

    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "How do I configure nginx for reverse proxy?"),
      createMessage("2", "assistant", {
        format: 2,
        parts: [
          {
            type: "text",
            text: "To configure nginx as a reverse proxy, edit your nginx.conf file and add a location block with proxy_pass directive.",
          },
        ],
      }),
    ];

    const result = await processor.processOutputResult({
      ...callArgs(),
      messages,
    });

    const assistantContent = result[1].content as any;
    expect(assistantContent.format).toBe(2);
    expect(assistantContent.metadata.reflectorAnalysis).toEqual(fakeAnalysis);
    expect(typeof assistantContent.metadata.reflectorTimestamp).toBe("string");
    // Original parts preserved
    expect(assistantContent.parts[0].text).toContain("nginx");

    restoreAgent();
  });

  test("preserves existing metadata on assistant message", async () => {
    mockAgentGenerate(async () => ({ object: fakeAnalysis }));
    const processor = new ReflectorProcessor();

    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "How do I configure nginx for reverse proxy?"),
      createMessage("2", "assistant", {
        format: 2,
        parts: [
          {
            type: "text",
            text: "To configure nginx as a reverse proxy, edit your nginx.conf file and add a location block with proxy_pass directive.",
          },
        ],
        metadata: { existingKey: "preserved-value" },
      }),
    ];

    const result = await processor.processOutputResult({
      ...callArgs(),
      messages,
    });

    const assistantContent = result[1].content as any;
    expect(assistantContent.metadata.existingKey).toBe("preserved-value");
    expect(assistantContent.metadata.reflectorAnalysis).toEqual(fakeAnalysis);

    restoreAgent();
  });

  test("does not mutate original messages array", async () => {
    mockAgentGenerate(async () => ({ object: fakeAnalysis }));
    const processor = new ReflectorProcessor();

    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "How do I configure nginx for reverse proxy?"),
      createMessage(
        "2",
        "assistant",
        "To configure nginx as a reverse proxy, edit your nginx.conf file and add a location block with proxy_pass directive.",
      ),
    ];
    const originalContent = messages[1].content;

    await processor.processOutputResult({
      ...callArgs(),
      messages,
    });

    // Original message should be untouched
    expect(messages[1].content).toBe(originalContent);

    restoreAgent();
  });

  test("analysis patterns are correctly structured in metadata", async () => {
    mockAgentGenerate(async () => ({ object: fakeAnalysis }));
    const processor = new ReflectorProcessor();

    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "How do I configure nginx for reverse proxy?"),
      createMessage(
        "2",
        "assistant",
        "To configure nginx as a reverse proxy, edit your nginx.conf file and add a location block with proxy_pass directive.",
      ),
    ];

    const result = await processor.processOutputResult({
      ...callArgs(),
      messages,
    });

    const analysis = (result[1].content as any).metadata.reflectorAnalysis;
    expect(analysis.patterns.length).toBe(2);
    expect(analysis.patterns[0].type).toBe("attention_signal");
    expect(analysis.patterns[1].type).toBe("noise_pattern");
    expect(analysis.insights.curationSuggestions).toBeInstanceOf(Array);
    expect(analysis.insights.curationSuggestions.length).toBe(2);

    restoreAgent();
  });

  test("LLM throws error → returns messages unchanged", async () => {
    mockAgentGenerate(async () => {
      throw new Error("LLM rate limited");
    });
    const processor = new ReflectorProcessor();

    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "How do I configure nginx for reverse proxy?"),
      createMessage(
        "2",
        "assistant",
        "To configure nginx as a reverse proxy, edit your nginx.conf file and add a location block with proxy_pass directive.",
      ),
    ];

    const result = await processor.processOutputResult({
      ...callArgs(),
      messages,
    });

    expect(result).toEqual(messages);

    restoreAgent();
  });

  test("LLM returns null object → returns messages unchanged", async () => {
    mockAgentGenerate(async () => ({ object: null }));
    const processor = new ReflectorProcessor();

    const messages: MastraDBMessage[] = [
      createMessage("1", "user", "How do I configure nginx for reverse proxy?"),
      createMessage(
        "2",
        "assistant",
        "To configure nginx as a reverse proxy, edit your nginx.conf file and add a location block with proxy_pass directive.",
      ),
    ];

    const result = await processor.processOutputResult({
      ...callArgs(),
      messages,
    });

    // Should either attach null or fail gracefully
    // The code does `analysis.patterns.length` which would throw on null → caught by try/catch
    expect(result).toEqual(messages);

    restoreAgent();
  });
});
