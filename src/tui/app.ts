// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Agent TUI Application
 *
 * Rich terminal interface for interacting with the agent via Harness.
 * Provides streaming responses, tool approval, and mode/model switching.
 */

import {
  TUI,
  ProcessTerminal,
  Container,
  Editor,
  Text,
  Spacer,
  CombinedAutocompleteProvider,
  matchesKey,
  Key,
} from "@mariozechner/pi-tui";

import { StateManager, type Message } from "./state";
import { createEventDispatcher, type HarnessEvent } from "./event-dispatch";
import { StatusLine } from "./components/status-line";
import { MessagesDisplay } from "./components/messages";
import { ToolApprovalDialog } from "./components/tool-approval";
import { SimpleLoader } from "./components/loader";
import { editorTheme, colors } from "./theme";

// Harness types
interface Harness {
  init(): Promise<void>;
  subscribe(callback: (event: HarnessEvent) => void): () => void;
  sendMessage(options: { content: string }): Promise<void>;
  steer(options: { content: string }): Promise<void>;
  followUp(options: { content: string }): void;
  abort(): void;
  respondToToolApproval(options: { decision: "approve" | "decline" }): void;
  grantSessionTool?(options: { toolName: string }): void;
  switchMode(options: { modeId: string }): Promise<void>;
  switchModel(options: { modelId: string }): Promise<void>;
  createThread(options: { title?: string }): Promise<{ id: string }>;
  switchThread(options: { threadId: string }): Promise<void>;
  listThreads(): Promise<Array<{ id: string; title?: string }>>;
  listModes(): Array<{ id: string; name: string }>;
  listAvailableModels(): Promise<Array<{ id: string; name?: string }>>;
  getCurrentModeId(): string;
  getCurrentModelId(): string;
  getCurrentThreadId(): string | null;
  getResourceId(): string;
  isRunning(): boolean;
}

interface TUIConfig {
  harness: Harness;
}

export class AgentTUI {
  private tui: TUI;
  private harness: Harness;
  private stateManager: StateManager;
  private dispatchEvent: (event: HarnessEvent) => void;

  // Components
  private statusLine: StatusLine;
  private messagesDisplay: MessagesDisplay;
  private toolApprovalDialog: ToolApprovalDialog;
  private loader: SimpleLoader;
  private editor: Editor;

  // State tracking
  private unsubscribeHarness: (() => void) | null = null;

  constructor(config: TUIConfig) {
    this.harness = config.harness;
    this.stateManager = new StateManager();
    this.dispatchEvent = createEventDispatcher(this.stateManager);

    // Create terminal and TUI
    const terminal = new ProcessTerminal();
    this.tui = new TUI(terminal);

    // Initialize components
    this.statusLine = new StatusLine();
    this.messagesDisplay = new MessagesDisplay();
    this.toolApprovalDialog = new ToolApprovalDialog();
    this.loader = new SimpleLoader("Thinking...");

    // Create editor with autocomplete
    const autocomplete = new CombinedAutocompleteProvider(
      [
        { name: "mode", description: "Switch agent mode" },
        { name: "model", description: "Switch model" },
        { name: "new", description: "Create new thread" },
        { name: "threads", description: "List threads" },
        { name: "clear", description: "Clear messages" },
        { name: "help", description: "Show help" },
        { name: "quit", description: "Exit TUI" },
      ],
      process.cwd()
    );

    this.editor = new Editor(this.tui, editorTheme);
    this.editor.setAutocompleteProvider(autocomplete);
    this.editor.onSubmit = (text) => this.handleSubmit(text);

    // Setup loader render callback
    this.loader.setOnRender(() => this.tui.requestRender());

    // Subscribe to state changes
    this.stateManager.subscribe((state) => {
      this.statusLine.setState(state);
      this.messagesDisplay.setMessages(state.messages);

      // Handle tool approval
      if (state.pendingApproval) {
        this.toolApprovalDialog.setApproval(state.pendingApproval, {
          onApprove: () => {
            this.harness.respondToToolApproval({ decision: "approve" });
            this.stateManager.setPendingApproval(null);
          },
          onDecline: () => {
            this.harness.respondToToolApproval({ decision: "decline" });
            this.stateManager.setPendingApproval(null);
          },
          onAlwaysAllow: () => {
            this.harness.grantSessionTool?.({ toolName: state.pendingApproval!.toolName });
            this.harness.respondToToolApproval({ decision: "approve" });
            this.stateManager.setPendingApproval(null);
          },
        });
      } else {
        this.toolApprovalDialog.setApproval(null, null);
      }

      // Handle loader
      if (state.isProcessing) {
        this.loader.start();
      } else {
        this.loader.stop();
      }

      this.tui.requestRender();
    });
  }

  async start(): Promise<void> {
    try {
      // Build UI
      const container = new Container();

      // Header
      container.addChild(new Text(colors.primary(" Scion Agent TUI"), 0, 0));
      container.addChild(new Spacer(1));

      // Status line
      container.addChild(this.statusLine);
      container.addChild(new Spacer(1));

      // Messages
      container.addChild(this.messagesDisplay);
      container.addChild(new Spacer(1));

      // Loader (shown when processing)
      container.addChild(this.loader);

      // Tool approval dialog
      container.addChild(this.toolApprovalDialog);

      // Editor
      container.addChild(new Spacer(1));
      container.addChild(this.editor);

      this.tui.addChild(container);

      // Initialize harness
      await this.harness.init();

      // Subscribe to harness events
      this.unsubscribeHarness = this.harness.subscribe((event: HarnessEvent) => {
        this.dispatchEvent(event);
      });

      // Update initial state
      this.stateManager.setState({
        connected: true,
        currentModeId: this.harness.getCurrentModeId(),
        currentModelId: this.harness.getCurrentModelId(),
        currentThreadId: this.harness.getCurrentThreadId(),
      });

      // Start TUI
      this.tui.start();

      // Handle global keys
      this.setupGlobalKeys();
    } catch (error) {
      console.error("Failed to start TUI:", error);
      process.exit(1);
    }
  }

  private setupGlobalKeys(): void {
    // Global debug key handler
    this.tui.onDebug = () => {
      const state = this.stateManager.getState();
      console.log("\n--- TUI Debug ---");
      console.log("State:", JSON.stringify(state, null, 2));
      console.log("-----------------\n");
    };
  }

  private async handleSubmit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      await this.handleCommand(trimmed);
      return;
    }

    // Add user message to display
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };
    this.stateManager.addMessage(userMessage);

    const state = this.stateManager.getState();

    // Handle steer vs new message
    if (state.isProcessing) {
      // Steer: interrupt and redirect
      await this.harness.steer({ content: trimmed });
    } else {
      // New message
      try {
        await this.harness.sendMessage({ content: trimmed });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.stateManager.setState({ error: errorMsg });
      }
    }
  }

  private async handleCommand(command: string): Promise<void> {
    const parts = command.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case "mode": {
        if (args.length === 0) {
          const modes = this.harness.listModes();
          const current = this.harness.getCurrentModeId();
          const modeList = modes.map((m) => (m.id === current ? `> ${m.name}` : `  ${m.name}`)).join("\n");
          this.addSystemMessage(`Available modes:\n${modeList}`);
        } else {
          try {
            await this.harness.switchMode({ modeId: args[0] });
            this.stateManager.setState({ currentModeId: args[0] });
            this.addSystemMessage(`Switched to mode: ${args[0]}`);
          } catch (error) {
            this.addSystemMessage(`Failed to switch mode: ${error}`);
          }
        }
        break;
      }

      case "model": {
        if (args.length === 0) {
          const models = await this.harness.listAvailableModels();
          const current = this.harness.getCurrentModelId();
          const modelList = models.slice(0, 10).map((m) => (m.id === current ? `> ${m.id}` : `  ${m.id}`)).join("\n");
          this.addSystemMessage(`Available models (top 10):\n${modelList}`);
        } else {
          try {
            await this.harness.switchModel({ modelId: args[0] });
            this.stateManager.setState({ currentModelId: args[0] });
            this.addSystemMessage(`Switched to model: ${args[0]}`);
          } catch (error) {
            this.addSystemMessage(`Failed to switch model: ${error}`);
          }
        }
        break;
      }

      case "new": {
        try {
          const thread = await this.harness.createThread({ title: args.join(" ") || undefined });
          this.stateManager.setState({ currentThreadId: thread.id });
          this.stateManager.clearMessages();
          this.addSystemMessage(`Created new thread: ${thread.id}`);
        } catch (error) {
          this.addSystemMessage(`Failed to create thread: ${error}`);
        }
        break;
      }

      case "threads": {
        try {
          const threads = await this.harness.listThreads();
          const current = this.harness.getCurrentThreadId();
          const threadList = threads
            .slice(0, 10)
            .map((t) => (t.id === current ? `> ${t.title || t.id}` : `  ${t.title || t.id}`))
            .join("\n");
          this.addSystemMessage(`Recent threads:\n${threadList}`);
        } catch (error) {
          this.addSystemMessage(`Failed to list threads: ${error}`);
        }
        break;
      }

      case "clear":
        this.stateManager.clearMessages();
        break;

      case "help":
        this.showHelp();
        break;

      case "quit":
      case "exit":
      case "q":
        this.stop();
        process.exit(0);
        break;

      default:
        this.addSystemMessage(`Unknown command: /${cmd}. Type /help for available commands.`);
    }
  }

  private addSystemMessage(content: string): void {
    this.stateManager.addMessage({
      id: crypto.randomUUID(),
      role: "system",
      content,
      timestamp: new Date(),
    });
  }

  private showHelp(): void {
    const help = `
Available Commands:
  /mode [name]    - Show modes or switch to a mode
  /model [id]     - Show models or switch to a model
  /new [title]    - Create a new thread
  /threads        - List recent threads
  /clear          - Clear message display
  /help           - Show this help
  /quit           - Exit the TUI

Keyboard:
  Enter           - Send message / submit
  Shift+Enter     - New line
  Tab             - Autocomplete
  Ctrl+C          - Exit

During Processing:
  Type & Enter    - Steer (redirect) the agent
  Escape          - Abort current operation
`;
    this.addSystemMessage(help);
  }

  stop(): void {
    this.loader.stop();
    this.unsubscribeHarness?.();
    this.tui.stop();
  }
}
