# WhatsApp Channel Setup

## Prerequisites

- A phone with WhatsApp installed and an active account
- The agent project running locally or deployed

## How It Works

The WhatsApp adapter uses [Baileys](https://github.com/WhiskeySockets/Baileys), an open-source WhatsApp Web client. It connects as a linked device on your WhatsApp account (like WhatsApp Web or Desktop). No Meta Business API or phone number verification required.

## 1. Enable WhatsApp

No external platform setup is needed. On first run, a QR code will print to the terminal.

## 2. Environment Variables

```bash
# Optional (WhatsApp is enabled when WHATSAPP_ENABLED=true)
WHATSAPP_ENABLED=true
WHATSAPP_SESSION_PATH=.agent/whatsapp-session   # Session persistence directory (default)
WHATSAPP_RESPOND_ALL=false                       # Respond to all messages, not just mentions/DMs
WHATSAPP_ALLOW_FROM=+1234567890,+0987654321      # Comma-separated phone numbers to allow
```

## 3. First-Time Setup

1. Set `WHATSAPP_ENABLED=true` in your `.env`
2. Start the agent: `bun run dev`
3. A QR code will appear in the terminal
4. Open WhatsApp on your phone > Settings > Linked Devices > Link a Device
5. Scan the QR code

The session persists in `WHATSAPP_SESSION_PATH` so you won't need to scan again unless the session expires.

## Verification

1. After scanning the QR code, the terminal should show "WhatsApp adapter connected"
2. Send a message to your WhatsApp number from another phone
3. The bot should respond within a few seconds

## Troubleshooting

- **QR code reappears on restart**: Check that `WHATSAPP_SESSION_PATH` points to a persistent directory and the process has write permissions
- **Session expires**: WhatsApp may disconnect linked devices after ~14 days of inactivity. Re-scan the QR code
- **Messages not received**: Ensure the sender's number is in the `WHATSAPP_ALLOW_FROM` list (if set)
