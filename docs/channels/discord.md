# Discord Channel Setup

## Prerequisites

- A Discord account
- A Discord server where you have admin permissions (or permission to add bots)
- The agent project running locally or deployed

## 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**, give it a name, and create it

## 2. Create a Bot

1. Go to the **Bot** section in the sidebar
2. Click **Reset Token** to generate a new token — this is your `DISCORD_BOT_TOKEN`
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required to read message text)
   - **Server Members Intent** (for allowlist by username)

## 3. Invite the Bot to Your Server

1. Go to **OAuth2 > URL Generator**
2. Under **Scopes**, check `bot` and `applications.commands`
3. Under **Bot Permissions**, check:
   - Send Messages
   - Read Message History
   - Attach Files
   - Use Slash Commands
   - Read Messages/View Channels
4. Copy the generated URL and open it in your browser
5. Select your server and authorize

## 4. Environment Variables

```bash
# Required
DISCORD_BOT_TOKEN=your-bot-token

# Optional
DISCORD_ENABLED=true                        # Set to 'false' to disable (default: true if token set)
DISCORD_APPLICATION_ID=your-app-id          # For slash commands (future)
DISCORD_GUILD_ID=your-guild-id              # For guild-specific commands
DISCORD_RESPOND_ALL=false                   # Respond to all messages, not just mentions/DMs
DISCORD_ALLOW_FROM=username1,123456789      # Comma-separated usernames or Discord user IDs
```

## Verification

1. Start the agent: `bun run dev`
2. Send a DM to the bot or @mention it in a server channel
3. The bot should respond within a few seconds

## Troubleshooting

- **Bot doesn't see messages**: Make sure "Message Content Intent" is enabled in the Discord Developer Portal under Bot settings
- **Bot can't join server**: Check that you selected the correct scopes (bot + applications.commands) in the OAuth2 URL
