# Slack Channel Setup

## Prerequisites

- A Slack workspace where you have admin permissions (or permission to install apps)
- The agent project running locally or deployed

## 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, give it a name, and select your workspace
3. Under **Socket Mode**, click **Enable Socket Mode** and generate an app-level token with `connections:write` scope — this is your `SLACK_APP_TOKEN` (starts with `xapp-`)

## 2. Configure Bot Permissions

1. Go to **OAuth & Permissions** in the sidebar
2. Under **Scopes > Bot Token Scopes**, add:
   - `chat:write` — send messages
   - `app_mentions:read` — respond to @mentions
   - `channels:history` — read channel messages
   - `groups:history` — read private channel messages
   - `im:history` — read DMs
   - `im:write` — send DMs
   - `files:read` — read file attachments
   - `files:write` — upload files
3. Click **Install to Workspace** and authorize
4. Copy the **Bot User OAuth Token** — this is your `SLACK_BOT_TOKEN` (starts with `xoxb-`)

## 3. Subscribe to Events

1. Go to **Event Subscriptions** and enable events
2. Under **Subscribe to bot events**, add:
   - `message.channels` — messages in public channels
   - `message.groups` — messages in private channels
   - `message.im` — direct messages
   - `app_mention` — @mentions of the bot
3. Save changes

## 4. Get Signing Secret

1. Go to **Basic Information**
2. Copy the **Signing Secret** — this is your `SLACK_SIGNING_SECRET`

## 5. Environment Variables

```bash
# Required
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret

# Optional
SLACK_ENABLED=true                    # Set to 'false' to disable (default: true if tokens set)
SLACK_RESPOND_ALL=false               # Respond to all messages, not just mentions/DMs
SLACK_ALLOW_FROM=U01ABC123,U02DEF456  # Comma-separated Slack user IDs to allow
```

## 6. Invite the Bot

Add the bot to channels by typing `/invite @your-bot-name` in any channel.

## Verification

1. Start the agent: `bun run dev`
2. Send a DM to the bot or @mention it in a channel
3. The bot should respond within a few seconds
