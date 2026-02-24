# Channel Authentication Methods Reference

## Overview

This document maps the authentication requirements for each channel adapter based on the actual implementation in `src/mastra/gateway/channels/`.

## Channel Summary

| Channel | Library | Auth Complexity | Onboarding Method |
|---------|---------|-----------------|-------------------|
| WhatsApp | Baileys | Medium | QR Code scan |
| Telegram | Grammy | Easy | Bot token input |
| Discord | Discord.js | Easy | Bot token input |
| Slack | @slack/bolt | Hard | OAuth flow + Socket Mode |
| Google Chat | googleapis | Medium | Service account JSON |
| Signal | signal-cli REST | Hard | External setup + config |
| iMessage | BlueBubbles | Hard | macOS + external setup |

---

## WhatsApp (Baileys)

### Auth Method: QR Code Scan

**Implementation**: `src/mastra/gateway/channels/whatsapp/adapter.ts`

```typescript
// Baileys connection
const socket = makeWASocket({
  auth: state,
  printQRInTerminal: true,  // QR displayed in terminal
});
```

**Onboarding Requirements**:
1. Session path configuration (where auth state stored)
2. QR code display in terminal (`qrcode-terminal`)
3. User scans QR with WhatsApp mobile app
4. Session persists across restarts

**Config**:
```typescript
interface WhatsAppChannelConfig {
  enabled: boolean;
  sessionPath: string;        // REQUIRED: Path to store auth state
  respondToAllMessages?: boolean;
  allowFrom?: string[];       // Phone number allowlist
}
```

**Onboarding UI**:
```
? Enable WhatsApp? (y/N) y
? Session storage path: (/home/user/.agent/whatsapp-session)

WhatsApp Setup

1. Open WhatsApp on your phone
2. Go to Settings → Linked Devices
3. Tap "Link a Device"
4. Scan the QR code below

[QR CODE DISPLAYED HERE]

Waiting for connection...
✓ Connected as: +1234567890
```

---

## Telegram (Grammy)

### Auth Method: Bot Token

**Implementation**: `src/mastra/gateway/channels/telegram/adapter.ts`

```typescript
constructor(config: TelegramChannelConfig) {
  this.bot = new Bot(config.token);  // Bot token required
}
```

**Onboarding Requirements**:
1. Guide user to @BotFather
2. Token input with validation
3. Validate token via `getMe` API call
4. Optional: Show bot info (name, username)

**Config**:
```typescript
interface TelegramChannelConfig {
  enabled: boolean;
  token: string;              // REQUIRED: Bot token from @BotFather
  respondToAllMessages?: boolean;
  allowFrom?: Array<string | number>;  // User IDs or usernames
  handleEditedMessages?: boolean;
  dropPendingUpdates?: boolean;  // Default: true
}
```

**Token Format**: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

**Onboarding UI**:
```
? Enable Telegram? (y/N) y

Telegram Setup

1. Open Telegram and message @BotFather
2. Send /newbot
3. Follow prompts to create your bot
4. Copy the bot token (looks like: 123456789:ABCdef...)

? Bot token: [input masked]
✓ Validating token...
✓ Connected! Bot: @MyAgentBot

? Respond to all messages in groups? (y/N) n
? Handle edited messages? (Y/n) y
```

**Validation**:
```typescript
async function validateTelegramToken(token: string): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await response.json();
  return data.ok === true;
}
```

---

## Discord (Discord.js)

### Auth Method: Bot Token

**Implementation**: `src/mastra/gateway/channels/discord/adapter.ts`

```typescript
constructor(config: DiscordChannelConfig) {
  this.client = new Client({ intents: [...] });
  // Token used in connect()
}

async connect(): Promise<void> {
  await this.client.login(this.config.token);
}
```

**Onboarding Requirements**:
1. Guide to Discord Developer Portal
2. Bot token input
3. Optional: Application ID for slash commands
4. Optional: Guild ID for testing

**Config**:
```typescript
interface DiscordChannelConfig {
  enabled: boolean;
  token: string;              // REQUIRED: Bot token
  applicationId?: string;     // Optional: For slash commands
  guildId?: string;           // Optional: For guild-specific commands
  respondToAllMessages?: boolean;
  allowFrom?: Array<string | number>;  // User IDs or usernames
}
```

**Onboarding UI**:
```
? Enable Discord? (y/N) y

Discord Setup

1. Go to https://discord.com/developers/applications
2. Click "New Application" → give it a name
3. Go to "Bot" section → "Add Bot"
4. Copy the bot token (click "Reset Token" if needed)
5. Enable intents: Message Content Intent (required)

? Bot token: [input masked]
? Application ID (for slash commands): [optional]
? Guild ID (for testing): [optional]

✓ Connecting to Discord Gateway...
✓ Connected! Bot: MyAgent#1234
```

---

## Slack (@slack/bolt)

### Auth Method: OAuth + Socket Mode

**Implementation**: `src/mastra/gateway/channels/slack/adapter.ts`

```typescript
constructor(config: SlackChannelConfig) {
  this.app = new App({
    token: config.botToken,        // Bot User OAuth Token (xoxb-...)
    appToken: config.appToken,     // App-Level Token (xapp-...)
    socketMode: true,              // Required for Bolt
    signingSecret: config.signingSecret,
  });
}
```

**Onboarding Requirements**:
1. Guide through Slack API app creation
2. Enable Socket Mode
3. Add required OAuth scopes
4. Collect 3 tokens: bot token, app token, signing secret

**Config**:
```typescript
interface SlackChannelConfig {
  enabled: boolean;
  botToken: string;           // REQUIRED: Bot User OAuth Token (xoxb-...)
  appToken: string;           // REQUIRED: App-Level Token (xapp-...)
  signingSecret: string;      // REQUIRED: Signing Secret
  respondToAllMessages?: boolean;
  allowFrom?: string[];       // Slack user IDs
}
```

**Onboarding UI**:
```
? Enable Slack? (y/N) y

Slack Setup (Multi-step OAuth)

Step 1: Create Slack App
1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name your app and select workspace

Step 2: Enable Socket Mode
1. Go to "Socket Mode" in left sidebar
2. Enable Socket Mode
3. Generate an App-Level Token with connections:write scope
4. Copy the token (starts with xapp-)

Step 3: Configure OAuth Scopes
1. Go to "OAuth & Permissions"
2. Add Bot Token Scopes:
   - app_mentions:read
   - chat:write
   - im:history
   - im:read
   - users:read
   - files:read

Step 4: Install to Workspace
1. Click "Install to Workspace"
2. Authorize the app
3. Copy the Bot User OAuth Token (starts with xoxb-)

Step 5: Get Signing Secret
1. Go to "Basic Information"
2. Copy the Signing Secret

? Bot User OAuth Token (xoxb-...): [input masked]
? App-Level Token (xapp-...): [input masked]
? Signing Secret: [input masked]

✓ Validating credentials...
✓ Connected! Bot: @MyAgent
```

---

## Google Chat (googleapis)

### Auth Method: Service Account JSON

**Implementation**: `src/mastra/gateway/channels/googlechat/adapter.ts`

```typescript
async connect(): Promise<void> {
  // Parse credentials (JSON string or file path)
  let credentials: any;
  if (this.config.credentials.startsWith('{')) {
    credentials = JSON.parse(this.config.credentials);
  } else {
    const content = await readFile(this.config.credentials, 'utf-8');
    credentials = JSON.parse(content);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  });
}
```

**Onboarding Requirements**:
1. Google Cloud project with Chat API enabled
2. Service account creation
3. Download JSON credentials
4. Project ID

**Config**:
```typescript
interface GoogleChatChannelConfig {
  enabled: boolean;
  credentials: string;        // REQUIRED: Service account JSON or path
  projectId: string;          // REQUIRED: Google Cloud project ID
  respondToAllMessages?: boolean;
}
```

**Onboarding UI**:
```
? Enable Google Chat? (y/N) y

Google Chat Setup

Step 1: Enable Chat API
1. Go to https://console.cloud.google.com/
2. Select or create a project
3. Go to "APIs & Services" → "Library"
4. Search for "Google Chat API" and enable it

Step 2: Create Service Account
1. Go to "IAM & Admin" → "Service Accounts"
2. Click "Create Service Account"
3. Name: scion-agent
4. Grant role: Chat Bot Viewer (or Chat App Viewer)

Step 3: Create Key
1. Click on the service account
2. Go to "Keys" tab
3. Click "Add Key" → "Create New Key"
4. Select JSON format
5. Download the JSON file

? Path to credentials JSON file: /path/to/credentials.json
? Google Cloud project ID: my-project-123456

✓ Validating credentials...
✓ Connected!

Note: You'll also need to configure the Chat app in Google Chat:
1. Go to Chat API Configuration in Google Cloud
2. Set HTTP endpoint URL to your gateway
3. Publish the app
```

---

## Signal (signal-cli REST)

### Auth Method: External Setup + Phone Number

**Implementation**: `src/mastra/gateway/channels/signal/adapter.ts`

```typescript
async connect(): Promise<void> {
  // Verify connection to signal-cli REST API
  const response = await fetch(`${this.config.apiUrl}/v1/about`);
  
  // Start polling for messages
  this.pollInterval = setInterval(async () => {
    await this.pollMessages();
  }, 1000);
}

async pollMessages(): Promise<void> {
  const response = await fetch(
    `${this.config.apiUrl}/v1/receive/${encodeURIComponent(this.config.phoneNumber)}`
  );
  // Process messages...
}
```

**Onboarding Requirements**:
1. **External prerequisite**: signal-cli must be set up separately
2. Phone number linked to Signal
3. REST API URL (signal-cli daemon)
4. Allowlist of phone numbers

**Config**:
```typescript
interface SignalChannelConfig {
  enabled: boolean;
  apiUrl: string;             // REQUIRED: signal-cli REST API URL
  phoneNumber: string;        // REQUIRED: Registered phone number
  respondToAllMessages?: boolean;
  allowFrom?: string[];       // Phone number allowlist
}
```

**Onboarding UI**:
```
? Enable Signal? (y/N) y

⚠️  Signal requires external setup

You must have signal-cli running as a daemon:

1. Install signal-cli: https://github.com/AsamK/signal-cli
2. Register/link your phone number:
   signal-cli link -n "Scion Agent"
   # Or register new:
   signal-cli register
3. Start REST API daemon:
   signal-cli daemon --http 0.0.0.0:8080

For Docker users:
  docker run -v signal-data:/data -p 8080:8080 \
    asamk/signal-cli-rest-api

? signal-cli REST API URL: http://localhost:8080
? Your phone number (with country code): +1234567890

✓ Checking signal-cli connection...
✓ Connected! Account: +1234567890

? Phone number allowlist (comma-separated): 
  (Leave empty to allow all)
```

---

## iMessage (BlueBubbles)

### Auth Method: macOS + BlueBubbles Server

**Implementation**: `src/mastra/gateway/channels/imessage/adapter.ts`

```typescript
async connect(): Promise<void> {
  // Verify connection to BlueBubbles REST API
  const response = await fetch(this.buildUrl('/api/v1/server/info'));
  
  // Start polling for messages
  this.pollInterval = setInterval(async () => {
    await this.pollMessages();
  }, 2000);
}
```

**Onboarding Requirements**:
1. **macOS required** - iMessage only works on macOS
2. BlueBubbles server running on Mac
3. API URL (BlueBubbles server)
4. Optional: API password

**Config**:
```typescript
interface IMessageChannelConfig {
  enabled: boolean;
  apiUrl: string;             // REQUIRED: BlueBubbles REST API URL
  apiPassword?: string;       // Optional: API password
  respondToAllMessages?: boolean;
  allowFrom?: string[];       // Contact allowlist
}
```

**Onboarding UI**:
```
? Enable iMessage? (y/N) y

⚠️  macOS + BlueBubbles Required

iMessage integration requires:
- A Mac running macOS (10.15+)
- BlueBubbles server (https://bluebubbles.app)

Setup Instructions:

1. On your Mac:
   - Install BlueBubbles from https://bluebubbles.app
   - Open BlueBubbles → Settings → API
   - Enable REST API server
   - Set port (default: 3000)
   - Optional: Set API password

2. Note the Mac's IP address:
   System Preferences → Network

3. Make sure Mac is accessible from this machine
   (same network or VPN)

? BlueBubbles API URL: http://192.168.1.100:3000
? API password (if set): [input masked]

✓ Checking BlueBubbles connection...
✓ Connected! macOS version: 14.2.1

⚠️  Note: Your Mac must remain on for iMessage to work
```

---

## Channel Enable/Disable Matrix

| Channel | Easy to Enable | Requires External Setup | Platform Restriction |
|---------|---------------|------------------------|---------------------|
| Telegram | ✅ Yes | ❌ No | None |
| Discord | ✅ Yes | ❌ No | None |
| WhatsApp | ✅ Yes | ❌ No | None |
| Google Chat | ⚠️ Medium | ⚠️ GCP setup | None |
| Slack | ❌ Complex | ⚠️ App setup | None |
| Signal | ❌ Complex | ✅ Yes (signal-cli) | None |
| iMessage | ❌ Complex | ✅ Yes (Mac) | ✅ macOS only |

---

## Onboarding Priority Recommendations

### Phase 1 (P0): Easy to Setup
1. **Telegram** - Simplest, token-based
2. **Discord** - Token-based, good for testing
3. **WhatsApp** - QR code, widely used

### Phase 2 (P1): Moderate Complexity
4. **Google Chat** - Service account, enterprise users

### Phase 3 (P2): Complex / External Dependencies
5. **Slack** - Multi-token OAuth
6. **Signal** - Requires signal-cli daemon
7. **iMessage** - Requires Mac + BlueBubbles

---

## Common Patterns

### Token Masking
All sensitive tokens should be masked in UI:
```typescript
const token = await ctx.prompter.password({
  message: 'Bot token',
  mask: '•',
});
```

### Validation
All tokens should be validated before saving:
```typescript
// Telegram example
const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
if (!response.ok) throw new Error('Invalid token');
```

### Allowlists
Most channels support allowlists for security:
```typescript
const allowFrom = await ctx.prompter.text({
  message: 'Allowlist (comma-separated, empty for all):',
});
const allowList = allowFrom.split(',').map(s => s.trim()).filter(Boolean);
```

### Respond Policy
Common question for all channels:
```typescript
const respondToAll = await ctx.prompter.confirm({
  message: 'Respond to all messages in groups/channels?',
  hint: 'If no, only responds to DMs and mentions',
  initialValue: false,
});
```

---

## Implementation Checklist

- [ ] WhatsApp QR code display (`qrcode-terminal`)
- [ ] Telegram token validation
- [ ] Discord token validation
- [ ] Slack 3-token OAuth flow
- [ ] Google Chat service account upload
- [ ] Signal CLI prerequisite check
- [ ] iMessage macOS detection
- [ ] Allowlist input for all channels
- [ ] Respond policy for all channels
- [ ] Connection test for each channel

---

*Document Version: 1.0*  
*Based on adapter implementations in src/mastra/gateway/channels/*
