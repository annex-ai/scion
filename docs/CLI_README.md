# Agent CLI

A Command Line Interface for the Agent project.

## Installation

```bash
# Install dependencies
npm install

# Run CLI directly (development)
npm run cli -- --help

# Or use tsx directly
npx tsx src/cli/index.ts --help
```

## Command Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `agent --message "Hello"` | Send message to agent |
| `agents list` | List configured agents |
| `agents add <name>` | Add new agent |
| `agents delete <id>` | Delete agent |
| `agents set-identity` | Update agent identity |

### Gateway Commands

| Command | Description |
|---------|-------------|
| `gateway start` | Start Gateway |
| `gateway stop` | Stop Gateway |
| `gateway status` | Show Gateway status |

### Channel Commands

| Command | Description |
|---------|-------------|
| `channels list` | List channels |
| `channels status` | Channel health |
| `channels connect <type>` | Connect channel |
| `channels disconnect <type>` | Disconnect channel |
| `message send` | Send message |

### Session & Memory Commands

| Command | Description |
|---------|-------------|
| `sessions list` | List sessions |
| `sessions show <id>` | Show session |
| `sessions reset <id>` | Reset session |
| `memory status` | Memory stats |
| `memory reset` | Clear memory |

### Configuration Commands

| Command | Description |
|---------|-------------|
| `setup` / `onboard` | Setup wizard |
| `config get` | View config |
| `config set <key> <value>` | Set config |
| `config init` | Init config |

### Tool Commands

| Command | Description |
|---------|-------------|
| `browser open <url>` | Open browser |
| `browser snapshot` | Page snapshot |
| `skills list` | List skills |
| `skills install <name>` | Install skill |
| `cron list` | List cron jobs |

### Maintenance Commands

| Command | Description |
|---------|-------------|
| `status` | System status |
| `doctor` | Health check |
| `logs` | View logs |

## Usage Examples

### Basic Agent Interaction

```bash
# Send a message to the default agent
agent --message "Hello, how are you?"

# Use a specific agent
agent --agent taskAgent --message "Summarize the logs"

# With thinking level
agent --message "Analyze this" --thinking high

# JSON output
agent --message "Status report" --json

# Stream response
agent --message "Tell me a story" --stream
```

### Gateway Management

```bash
# Start gateway
agent gateway start

# Start on custom port
agent gateway start --port 8080

# Check status
agent gateway status
```

### Channel Management

```bash
# List channels
agent channels list

# Connect WhatsApp
agent channels connect whatsapp

# Connect Telegram
agent channels connect telegram

# Disconnect
agent channels disconnect telegram
```

### Configuration

```bash
# Initialize config
agent config init

# View config
agent config get

# Set value
agent config set gateway.port 8080

# Setup wizard
agent setup
```

## Configuration

Configuration is stored in `~/.agent/config.json`:

```json
{
  "version": 1,
  "agent": {
    "model": "anthropic/claude-opus-4-6",
    "thinking": "medium",
    "verbose": "off"
  },
  "gateway": {
    "host": "localhost",
    "port": 4111
  },
  "channels": {}
}
```

## Feature Parity Status

| Feature | Status | Notes |
|---------|--------|-------|
| agent | ✅ | Basic implementation |
| agents list | ✅ | Working |
| agents add/delete | ✅ | Working |
| agents set-identity | ✅ | Basic implementation |
| gateway start/stop | ⚠️ | Needs daemon implementation |
| gateway status | ✅ | Working |
| channels list/status | ✅ | Working |
| channels connect | ⚠️ | Basic implementation |
| message send | ⚠️ | Needs gateway integration |
| sessions | ✅ | Basic implementation |
| memory | ✅ | Basic implementation |
| config | ✅ | Working |
| setup/onboard | ✅ | Working |
| browser | ⚠️ | Placeholder |
| skills | ⚠️ | Needs implementation |
| cron | ⚠️ | Placeholder |
| status | ✅ | Working |
| doctor | ✅ | Basic implementation |
| logs | ⚠️ | Placeholder |

## Development

```bash
# Run CLI in development
npm run cli -- <command>

# Example
npm run cli -- agent --message "Hello"
npm run cli -- gateway status
```

## Architecture

The CLI is built with Commander.js:

```
src/cli/
├── index.ts              # Entry point
├── commands/             # Command modules
│   ├── agent.ts          # Agent interaction
│   ├── agents.ts         # Agent management
│   ├── gateway.ts        # Gateway control
│   ├── channels.ts       # Channel management
│   ├── message.ts        # Message sending
│   ├── sessions.ts       # Session management
│   ├── memory.ts         # Memory operations
│   ├── config.ts         # Configuration
│   ├── status.ts         # Status/health
│   ├── doctor.ts         # Diagnostics
│   ├── browser.ts        # Browser control
│   ├── skills.ts         # Skill management
│   ├── logs.ts           # Log viewing
│   ├── setup.ts          # Setup wizard
│   └── cron.ts           # Cron jobs
└── lib/                  # Utilities
    ├── client.ts         # Mastra API client
    ├── config.ts         # Config management
    └── output.ts         # Output formatting
```

## Next Steps

1. **Gateway Integration**: Complete the gateway start/stop implementation
2. **Channel Auth**: Implement proper channel authentication flows
3. **Message Sending**: Connect to gateway for outbound messages
4. **Browser Control**: Integrate existing browser tools
5. **Skills System**: Implement skill installation/management
6. **Logging**: Add log aggregation and viewing
