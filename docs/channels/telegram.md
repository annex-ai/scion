# Telegram Channel Setup

## Prerequisites

- A Telegram account
- The agent project running locally or deployed

## 1. Create a Bot via BotFather

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts to choose a name and username
3. BotFather will give you a **bot token** — this is your `TELEGRAM_BOT_TOKEN`

## 2. Configure Bot Settings (Optional)

Still in BotFather:

- `/setprivacy` — set to **Disable** if you want the bot to see all group messages (not just commands/@mentions)
- `/setdescription` — set a description for the bot
- `/setuserpic` — set a profile picture

## 3. Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ

# Optional
TELEGRAM_ENABLED=true                       # Set to 'false' to disable (default: true if token set)
TELEGRAM_RESPOND_ALL=false                  # Respond to all group messages, not just mentions
TELEGRAM_ALLOW_FROM=username1,123456789     # Comma-separated usernames or numeric IDs
TELEGRAM_HANDLE_EDITS=false                 # Whether to process edited messages
TELEGRAM_DROP_PENDING=true                  # Drop pending updates on startup
```

## 4. Add Bot to Groups (Optional)

1. Open the group in Telegram
2. Go to **Group Settings > Add Members**
3. Search for your bot by username and add it
4. If the group has restricted permissions, make the bot an admin

## Verification

1. Start the agent: `bun run dev`
2. Open a DM with your bot in Telegram and send a message
3. The bot should respond within a few seconds
