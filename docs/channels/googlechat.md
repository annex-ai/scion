# Google Chat Channel Setup

## Prerequisites

- A Google Workspace account (Google Chat is not available on personal Gmail accounts)
- Admin access to a Google Cloud project
- A public HTTPS endpoint for webhooks (or a tunnel like Cloudflare Tunnel / Tailscale Funnel)

## 1. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Note the **Project ID**

## 2. Enable the Chat API

1. Go to **APIs & Services > Library**
2. Search for "Google Chat API" and enable it

## 3. Create a Service Account

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > Service Account**
3. Give it a name and grant the **Chat Bots** role
4. Click on the service account, go to **Keys > Add Key > Create new key > JSON**
5. Download the JSON key file

## 4. Configure the Chat App

1. Go to **APIs & Services > Google Chat API > Configuration**
2. Set the **App name** and **Description**
3. Under **Connection settings**, select **HTTP endpoint URL**
4. Set the webhook URL to: `https://<your-domain>/_gateway/webhook/googlechat`
5. Under **Visibility**, choose who can find and use the bot
6. Save

## 5. Set Up a Public HTTPS Endpoint

Google Chat requires a publicly accessible HTTPS URL for webhooks. Options:

### Cloudflare Tunnel (recommended)
```bash
cloudflared tunnel --url http://localhost:4111
```

### Tailscale Funnel
```bash
tailscale funnel 4111
```

### ngrok
```bash
ngrok http 4111
```

Update the webhook URL in step 4 with the generated public URL.

## 6. Environment Variables

```bash
# Required
GOOGLE_CHAT_CREDENTIALS=/path/to/service-account-key.json   # Or inline JSON string
GOOGLE_CHAT_PROJECT_ID=your-project-id

# Optional
GOOGLE_CHAT_ENABLED=true              # Set to 'false' to disable (default: true if credentials set)
GOOGLE_CHAT_RESPOND_ALL=false         # Respond to all messages in spaces, not just mentions
```

## Verification

1. Start the agent: `bun run dev`
2. Ensure your tunnel is running and the webhook URL is accessible
3. Open Google Chat and add the bot to a space or DM it directly
4. Send a message mentioning the bot
5. The bot should respond within a few seconds

## Troubleshooting

- **Webhook 403**: The `/_gateway/webhook/googlechat` path must be in the SimpleAuth public paths (already configured)
- **Bot not visible**: Check the Chat API configuration visibility settings in Google Cloud Console
- **Authentication errors**: Ensure the service account JSON key is valid and the Chat API is enabled
