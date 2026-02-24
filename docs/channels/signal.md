# Signal Channel Setup

## Prerequisites

- A phone number registered with Signal
- Java 17+ installed (required by signal-cli)
- The agent project running locally or deployed

## How It Works

The Signal adapter connects to [signal-cli](https://github.com/AsamK/signal-cli) running in REST API mode. signal-cli handles the Signal protocol; our adapter polls it for messages.

## 1. Install signal-cli

### macOS
```bash
brew install signal-cli
```

### Linux
```bash
# Download the latest release from https://github.com/AsamK/signal-cli/releases
wget https://github.com/AsamK/signal-cli/releases/download/v0.13.4/signal-cli-0.13.4-Linux.tar.gz
tar xf signal-cli-0.13.4-Linux.tar.gz -C /opt/
ln -sf /opt/signal-cli-0.13.4/bin/signal-cli /usr/local/bin/signal-cli
```

## 2. Register or Link a Phone Number

### Option A: Register a new number
```bash
signal-cli -u +1234567890 register
signal-cli -u +1234567890 verify CODE_FROM_SMS
```

### Option B: Link as secondary device
```bash
signal-cli link -n "Agent Bot" | tee >(xargs -L 1 qrencode -t UTF8)
```
Scan the QR code with Signal on your phone (Settings > Linked Devices).

## 3. Start the REST API

```bash
signal-cli -u +1234567890 daemon --http localhost:8080
```

Keep this running in the background (use `systemd`, `tmux`, or `screen`).

## 4. Environment Variables

```bash
# Required
SIGNAL_API_URL=http://localhost:8080
SIGNAL_PHONE_NUMBER=+1234567890

# Optional
SIGNAL_ENABLED=true                          # Set to 'false' to disable (default: true if API URL set)
SIGNAL_RESPOND_ALL=false                     # Respond to all group messages
SIGNAL_ALLOW_FROM=+1111111111,+2222222222    # Comma-separated phone numbers to allow
```

## Verification

1. Ensure signal-cli REST daemon is running
2. Start the agent: `bun run dev`
3. Send a Signal message to the registered number
4. The bot should respond within a few seconds

## Troubleshooting

- **Messages not received**: Ensure signal-cli is started with `--http` flag (not `--json-rpc`)
- **Connection refused**: Check that `SIGNAL_API_URL` matches the host:port of the signal-cli daemon
- **Java errors**: signal-cli requires Java 17+. Check with `java -version`
