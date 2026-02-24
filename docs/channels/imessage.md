# iMessage Channel Setup

## Prerequisites

- A Mac running macOS with iMessage configured and signed in
- [BlueBubbles](https://bluebubbles.app/) server installed on the Mac
- The agent project running (can be on the same Mac or a different machine with network access)

## How It Works

The iMessage adapter connects to [BlueBubbles](https://bluebubbles.app/), a macOS app that exposes iMessage via a REST API. BlueBubbles runs on the Mac alongside Messages.app and provides HTTP endpoints for sending/receiving messages.

## 1. Install BlueBubbles

1. Download BlueBubbles from [bluebubbles.app](https://bluebubbles.app/)
2. Install and open it on your Mac
3. Follow the setup wizard to configure the server

## 2. Configure BlueBubbles

1. In BlueBubbles, go to **Settings**
2. Enable the **REST API**
3. Note the **API URL** (e.g., `http://localhost:1234`)
4. Note the **API Password** (required for authentication)

## 3. Environment Variables

```bash
# Required
IMESSAGE_API_URL=http://localhost:1234

# Optional
IMESSAGE_ENABLED=true                        # Set to 'false' to disable (default: true if API URL set)
IMESSAGE_API_PASSWORD=your-bluebubbles-password  # BlueBubbles API password
IMESSAGE_RESPOND_ALL=false                   # Respond to all messages in group chats
IMESSAGE_ALLOW_FROM=+1234567890,user@icloud.com  # Comma-separated phone numbers or emails
```

## Verification

1. Ensure BlueBubbles is running on the Mac
2. Start the agent: `bun run dev`
3. Send an iMessage to the Mac's phone number or Apple ID
4. The bot should respond within a few seconds

## Troubleshooting

- **Connection refused**: Ensure BlueBubbles server is running and the API URL is correct
- **Attachment errors**: BlueBubbles requires `?password=` query param on all API requests including attachment downloads
- **Messages delayed**: The adapter polls every 2 seconds. Check that BlueBubbles is receiving messages in its own UI first
