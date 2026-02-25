# Scion

**Autonomous AI Agent**

[![CI](https://github.com/annex-ai/scion/actions/workflows/ci.yml/badge.svg)](https://github.com/annex-ai/scion/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Version](https://img.shields.io/github/v/release/annex-ai/scion?label=version)](https://github.com/annex-ai/scion/releases)

An autonomous AI agent with multi-channel messaging, proactive notifications, and self-directed task orchestration — built on [Mastra](https://mastra.ai/).

```
           Slack  Telegram  Discord  WhatsApp  Google Chat  Signal  iMessage
             │       │        │         │          │          │        │
             └───────┴────────┴─────────┴──────────┴──────────┴────────┘
                                        │
                              ┌─────────▼──────────┐
                              │     Gateway         │
                              │  rate limit · auth  │
                              │  media · sessions   │
                              └─────────┬──────────┘
                                        │  HTTP POST
                              ┌─────────▼──────────┐
                              │   Input Pipeline    │
                              │  normalize → detect │
                              │  → classify → route │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │   Agent Runner      │
                              │  soul · memory ·    │
                              │  tools · skills     │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │   Agentic Loop      │
                              │  plan → execute →   │
                              │  assess → iterate   │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │   Output Pipeline   │
                              │  PII redact → chunk │
                              │  → format → deliver │
                              └──────────────────────┘
```

---

## Channels

Scion connects to 7 messaging platforms through a unified adapter interface.

| Channel     | Library       | Allowlist       | Threading            | Media          |
|-------------|---------------|-----------------|----------------------|----------------|
| Slack       | @slack/bolt   | `SLACK_ALLOW_FROM` | `thread_ts`       | images, files  |
| Telegram    | Grammy        | built-in config | `message_thread_id`  | images, voice, video, docs |
| Discord     | Discord.js    | —               | message references   | images, files  |
| WhatsApp    | Baileys       | —               | quoted messages      | images, voice, video, docs |
| Google Chat | Google APIs   | —               | thread keys          | images         |
| Signal      | signal-cli    | —               | quotes               | images, files  |
| iMessage    | BlueBubbles   | —               | —                    | images, files  |

**Key capabilities:**
- **Platform-native formatting** — Slack mrkdwn, Telegram HTML, Discord markdown, etc.
- **Message chunking** — splits long responses to fit each platform's limits
- **Media handling** — download, MIME detection, storage, transcription (audio), description (images)
- **Allowlists** — restrict which users/channels can interact, per platform

---

## Adapters

Each channel implements a `ChannelAdapter` with four lifecycle methods: `connect`, `disconnect`, `sendMessage`, and `onMessage`.

**Inbound flow:** channel event → `toInboundMessage()` normalization → gateway routing

**Outbound flow:** agent response → `toChannelFormat()` → `chunkForChannel()` → platform API

**Sessions:** persistent via `SESSIONS.md` with deterministic thread IDs. Users can reset context with `/new` or `/reset` commands.

See [docs/CRON_SESSION_MANAGEMENT.md](docs/CRON_SESSION_MANAGEMENT.md) for session lifecycle details.

---

## Gateway

`GatewayServer` orchestrates channel lifecycle, message routing, and security enforcement.

| Concern | Implementation |
|---------|---------------|
| **Rate limiting** | In-memory, per-session 30/min, per-user 50/min, 5-min cleanup cycle |
| **Authentication** | `SimpleAuth` with Bearer token via `GATEWAY_API_KEY`; health endpoints public |
| **Agent bridge** | HTTP POST to `/api/agents/interactiveAgent/generate` — no circular deps |
| **Startup/shutdown** | Graceful: services → channels → cleanup |
| **Logging** | Structured JSON, component-tagged |
| **Media pipeline** | Download → MIME detect → store → transcribe/describe → attach to message |

---

## Agent Runner

The core agent system — configuration, personality, memory, and processing pipelines.

### Configuration

All settings live in `agent.toml` (single source of truth):
- Identity, archetype, Big Five personality traits
- Model selection (default, safeguard models)
- Feature flags, memory settings, server config
- Heartbeat schedule and targets

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the complete reference.

### Soul System

Three markdown files define the agent's personality, hot-reloaded on file change:

| File | Purpose |
|------|---------|
| `IDENTITY.md` | Name, vibe, voice examples, speaking style |
| `SOUL.md` | Core truths, boundaries, tone, continuity rules |
| `USER.md` | User preferences, timezone, communication style |

### Memory

| Layer | Description |
|-------|-------------|
| **Recent messages** | Last N messages from the thread (configurable, default 30) |
| **Semantic recall** | FastEmbed embeddings + LibSQL vector search (top-k, resource-scoped) |
| **Observational Memory** | Automatic long-context management — observation and reflection passes triggered by token thresholds, resource-scoped by default |

Observational Memory is configured in `agent.toml` under `[memory]` and enabled by default on the interactive agent (`om_mode = "static"`). Resource-scoped OM spans all threads for the user, making it ideal for always-on agents receiving inputs across multiple channels.

See [docs/MEMORY_SYSTEM.md](docs/MEMORY_SYSTEM.md) for architecture details.

### Processing Pipelines

**Input chain** (runs before the agent sees the message):

1. **UnicodeNormalizer** — canonicalize text encoding
2. **AdversarialPatternDetector** — fast regex scan for injection patterns
3. **PromptInjectionDetector** — LLM-based classification (safeguard model)
4. **SkillsProcessor** — match and route to pre-compiled skill workflows

**Output chain** (runs before the response reaches the user):

1. **PIIDetector** — LLM-based PII detection with mask redaction
2. **BatchPartsProcessor** — batch streaming response parts

### Multi-Agent System

| Agent | Role |
|-------|------|
| **Interactive** | Main conversational agent — handles user messages, tool use, skill dispatch |
| **Task** | Subagent for bash execution, code analysis, research, planning |
| **Reflector** | Pattern synthesis — matches observations to existing patterns, creates new patterns, flags contradictions (structured output) |
| **Observer** | Extracts behavioral observations from conversation history for the adaptation pipeline |
| **Message Analyzer** | Extracts action items, commitments, deadlines from conversations |

### Tools & MCP

30+ built-in tools (file ops, search, bash with PTY/background process management, web, browser, TTS, task management, cron control, and more) plus external tools loaded via MCP (`mcp.json` with env var substitution).

See [docs/TASK_TOOLS.md](docs/TASK_TOOLS.md) for the task orchestration tools.

---

## Tools

Scion has 30+ built-in tools organized by category:

### File Operations

| Tool | Description |
|------|-------------|
| `read` | Read file contents with optional offset/limit pagination |
| `write` | Create or overwrite files |
| `edit` | Find and replace text in files |
| `glob` | Find files matching patterns (e.g., `**/*.ts`) |
| `grep` | Search file contents with regex support |
| `ls` | List directory contents |
| `notebook-edit` | Edit Jupyter notebook cells |

### Shell & Execution

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands with optional timeout, cwd, PTY mode (colors, interactive programs), and background mode (long-running sessions) |
| `process` | Manage background processes: list, poll output, read logs, write stdin, paste, submit lines, send key sequences (C-c, arrows, etc.), and kill |

See [docs/PROCESS_MANAGEMENT.md](docs/PROCESS_MANAGEMENT.md) for the complete process management reference.

### Web & Browser

| Tool | Description |
|------|-------------|
| `browser` | Browser automation via Chrome DevTools Protocol + Playwright (start/stop, tabs, navigate, snapshot, screenshot, act) |
| `web-search` | Search the web using DuckDuckGo |
| `web-fetch` | Fetch and convert URLs to markdown |

### Multi-CLI Reasoning

| Tool | Description |
|------|-------------|
| `claude` | Run Claude CLI for deep reasoning and security audits |
| `codex` | Run Codex CLI for code generation (OpenAI) |
| `gemini` | Run Gemini CLI for analysis and debugging |
| `kimi` | Run Kimi CLI for general coding assistance |

### Task Management

| Tool | Description |
|------|-------------|
| `task-create` | Decompose goals into actionable subtasks (AI-powered) |
| `task-update` | Update task status, add blockers |
| `task-list` | List all tasks with optional status filter |
| `task-get` | Get single task details |
| `task-archive` | Archive completed tasks and clear working memory |

### Flows & Orchestration

| Tool | Description |
|------|-------------|
| `kimi-flow` | Execute Kimi flow skills (SKILL.md) |
| `goose-flow` | Execute Goose YAML recipes |
| `plan-mode` | Draft changes before applying (diff preview) |
| `sequential-thinking` | Structured step-by-step problem analysis |

### Agent Delegation

| Tool | Description |
|------|-------------|
| `delegate-to-agent` | Fire-and-forget delegation to ephemeral specialist (swarm pattern) |
| `handoff-to-agent` | Coordinated delegation with shared context (team pattern) |

### Scheduling & Proactive

| Tool | Description |
|------|-------------|
| `cron-manage` | Create, update, delete scheduled tasks |
| `cron-list` | List all schedules with next run times |
| `heartbeat-control` | Run, pause, resume, or check heartbeat status |

### Soul System

| Tool | Description |
|------|-------------|
| `update-preferences` | Update user preferences (communication style, expertise, goals) |
| `new-session` | Start a fresh conversation session |

### Media & Output

| Tool | Description |
|------|-------------|
| `image` | Read, resize, and convert images |
| `text-to-speech` | Convert text to audio for voice delivery |
| `ask-user` | Ask clarifying questions |

---

## Agentic Loops

Scion supports 5 configurable orchestration patterns via the `[loop]` section in `agent.toml`. Each pattern defines how the agent approaches tasks — from single-agent iteration to multi-agent coordination.

| Pattern | Phases | Best For |
|---------|--------|----------|
| **kimi-loop** (default) | Plan → Execute → Verify | General-purpose task execution, coding, multi-step problems |
| **task-based** | Planning → Execution → Finalization | Structured task decomposition with sequential execution |
| **ralph-loop** | Gather → Analyze → Synthesize | Research questions, information gathering, comparative analysis |
| **agent-swarm** | Plan → Delegate → Collect → Synthesize | Tasks requiring diverse expertise via `delegate-to-agent` |
| **agent-team** | Staff → Plan → Handoff → Review → Deliver | Complex projects with interdependent components via `handoff-to-agent` |

| Setting | Default | Description |
|---------|---------|-------------|
| `max_iterations` | 3 | Max loop cycles (0 = disabled, -1 = unlimited) |
| `max_steps_per_turn` | 50 | Tool calls per iteration |
| `max_retries_per_step` | 3 | Retries on step failure |

**Loop cycle:** read working memory → execute tasks → update state → self-assess completion (CONTINUE/STOP)

**Working memory schema:** goal, task queue with priorities, progress log, scratchpad notes

**Completion protocol:** on STOP, the agent delivers a structured summary to the user with results, decisions made, and any items needing attention.

See [docs/LOOP_PATTERNS.md](docs/LOOP_PATTERNS.md) for detailed pattern documentation and how to add custom patterns.

---

## Response

After the agent produces output, the response flows through:

1. **PII redaction** — mask sensitive data before it leaves the system
2. **Media extraction** — TTS audio from tool results becomes voice messages
3. **Channel formatting** — convert to platform-native markup
4. **Chunking** — split to fit platform message-size limits
5. **Delivery** — send via the originating channel adapter
6. **Error handling** — user-friendly messages for aborts, stream errors, tool failures, and rate limit hits

---

## Supporting Systems

### Services

Two in-process services run within the Gateway, plus a reflection workflow:

| Component | Config Section | Purpose | Schedule Source |
|-----------|----------------|---------|-----------------|
| **CronService** | `[cron]` | Agent-defined CRON schedules from `CRON.md` | `CRON.md` (agent-managed) |
| **HeartbeatService** | `[heartbeat]` | Proactive working memory monitoring | `agent.toml` (system-defined) |
| **Reflection Workflow** | `[attention_steering]` | Pattern extraction from conversations | On-demand / `agent.toml` |

#### CronService
Manages agent-derived schedules from `CRON.md`. The agent can create, update, and delete schedules using the `cron-manage` tool. Supports both shared (persistent context) and isolated (fresh context per run) session modes.

#### HeartbeatService
Proactive notification pipeline that checks for incomplete tasks, blocked items, and background task issues. Runs on a configurable schedule (default: every 30 min during active hours 9am–9pm). Supports pause/resume and 24-hour deduplication.

#### Adaptation Pipeline (Observe → Reflect → Coach)
Mastra workflow pipeline: the observer agent extracts behavioral observations from conversations, the reflector agent synthesizes observations into patterns (reinforcements, new patterns, contradictions) using LLM-based structured output with heuristic fallback, and the coach generates actionable suggestions. Triggered via HTTP API or scheduled.

See individual documentation for details:
- [docs/CRON_SESSION_MANAGEMENT.md](docs/CRON_SESSION_MANAGEMENT.md)
- [docs/HEARTBEAT_SYSTEM.md](docs/HEARTBEAT_SYSTEM.md)
- [docs/REFLECTION_SYSTEM.md](docs/REFLECTION_SYSTEM.md)

### Skills

11 pre-compiled skill workflows defined as `SKILL.md` files with Mermaid flowcharts. The native flow compiler converts these to Mastra workflows at load time.

Available skills: bug-investigator, code-explainer, code-review, content-writer, default-ralph, multi-step-analysis, project-planner, sentiment-analyzer, simple-math, text-summarizer, text-translator

See [docs/SKILL_SPEC.md](docs/SKILL_SPEC.md) for the skill definition format.

### Observability

Tracing via `@mastra/observability` with `DefaultExporter` and `CloudExporter`. A `SensitiveDataFilter` scrubs PII from trace payloads before export.

---

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0 (or Node.js >= 22.13)
- At least one LLM API key (Google AI, OpenAI, or Anthropic)
- At least one messaging channel token to connect (Slack, Telegram, Discord, etc.)

## Quick Start

Get a working agent in under 5 minutes:

```shell
# 1. Clone and install
git clone https://github.com/annex-ai/scion.git
cd agent
bun install

# 2. Configure environment
cp .env.example .env
# Open .env and add your LLM key + at least one channel token.
# See .env.example for all options — the minimum is:
#   GOOGLE_GENERATIVE_AI_API_KEY=your-key    (or ANTHROPIC_API_KEY / OPENAI_API_KEY)
#   TELEGRAM_BOT_TOKEN=your-token            (or any other channel)

# 3. Start the agent
bun run dev
```

**Verify it works:**

- Open [http://localhost:4111](http://localhost:4111) — you should see [Mastra Studio](https://mastra.ai/docs/getting-started/studio)
- Send a message to your bot on the configured channel — the agent should respond

**Next steps:**
- Edit `.agent/IDENTITY.md` to customize the agent's personality
- Add more channels by uncommenting tokens in `.env`
- Explore the [configuration reference](docs/CONFIGURATION.md)

## Environment Variables

All variables are documented in [`.env.example`](.env.example). Key categories:

```bash
# Required (at least one LLM provider)
GOOGLE_GENERATIVE_AI_API_KEY=...   # Default provider
ANTHROPIC_API_KEY=...              # Alternative
OPENAI_API_KEY=...                 # Alternative (also used for embeddings)

# Channels (enable any combination)
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...

# Security (optional)
GATEWAY_API_KEY=...           # Enables Bearer auth on the gateway
SLACK_ALLOW_FROM=user1,user2  # Slack user/channel allowlist

# Database (defaults to local SQLite)
DATABASE_URL=file:./local.db

# Observability (optional)
OPENROUTER_API_KEY=...        # For safeguard models (prompt injection, PII)
```

See [docs/CHANNEL_AUTH_METHODS.md](docs/CHANNEL_AUTH_METHODS.md) for channel-specific setup guides.

## Documentation

| Document | Description |
|----------|-------------|
| [CONFIGURATION.md](docs/CONFIGURATION.md) | Complete `agent.toml` reference |
| [SERVICES.md](docs/SERVICES.md) | Overview of Gateway services |
| [CRON_SESSION_MANAGEMENT.md](docs/CRON_SESSION_MANAGEMENT.md) | CRON schedules and session lifecycle |
| [HEARTBEAT_SYSTEM.md](docs/HEARTBEAT_SYSTEM.md) | Proactive working memory monitoring |
| [REFLECTION_SYSTEM.md](docs/REFLECTION_SYSTEM.md) | Pattern aggregation from conversations |
| [MEMORY_SYSTEM.md](docs/MEMORY_SYSTEM.md) | Memory architecture and recall system |
| [TASK_TOOLS.md](docs/TASK_TOOLS.md) | Task management and orchestration tools |
| [PROCESS_MANAGEMENT.md](docs/PROCESS_MANAGEMENT.md) | Bash PTY/background modes and process management |
| [SKILL_SPEC.md](docs/SKILL_SPEC.md) | Skill definition format and flow compiler |
| [LOOP_PATTERNS.md](docs/LOOP_PATTERNS.md) | Configurable agentic loop patterns |
| [SECURITY_ASSESSMENT.md](docs/SECURITY_ASSESSMENT.md) | Security model and threat assessment |
| [MEMORY_SCHEMA_ERD.md](docs/MEMORY_SCHEMA_ERD.md) | Memory database schema |
| [PROMPT_INJECTION_DETECTOR.md](docs/PROMPT_INJECTION_DETECTOR.md) | Prompt injection detection design |

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

By opening a pull request you agree to the Contributor License Agreement described in CONTRIBUTING.md.

## Learn More

- [Mastra Documentation](https://mastra.ai/docs/)
- [Mastra Course](https://mastra.ai/course)
- [Discord Community](https://discord.gg/BTYqqHKUrf)

## Acknowledgments

Scion was inspired by OpenClaw and is built on the [Mastra](https://mastra.ai/) framework. We are grateful to the Mastra team for creating an excellent foundation for AI agent development.

## License

Scion is licensed under the [GNU Affero General Public License v3.0](LICENSE).

This means you can freely use, modify, and distribute Scion, but if you run a modified version as a network service, you must make the source code available to users of that service. See the [LICENSE](LICENSE) file for full terms.
