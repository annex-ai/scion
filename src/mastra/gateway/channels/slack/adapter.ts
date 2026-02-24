// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Slack channel adapter using Bolt SDK with Socket Mode
 */

import { App } from "@slack/bolt";
import { readMediaFile, saveMediaBuffer } from "../media/store";
import type {
  ChannelAdapter,
  InboundAttachment,
  InboundMessage,
  OutboundAttachment,
  OutboundMessage,
  SlackChannelConfig,
} from "../types";
import { type SlackFile, type SlackMessageEvent, chunkForSlack, toInboundMessage, toSlackFormat } from "./format";

/**
 * Fetch a Slack file URL handling cross-origin redirects properly.
 * Slack file URLs redirect to CDN domains with pre-signed URLs.
 * The initial request needs auth, but the redirect doesn't.
 */
async function fetchWithSlackAuth(url: string, token: string): Promise<Response> {
  // Initial request with auth and manual redirect handling
  const initialRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "manual",
  });

  // If not a redirect, return the response directly
  if (initialRes.status < 300 || initialRes.status >= 400) {
    return initialRes;
  }

  // Handle redirect - the redirected URL is pre-signed and doesn't need auth
  const redirectUrl = initialRes.headers.get("location");
  if (!redirectUrl) {
    throw new Error("Slack redirect missing Location header");
  }

  console.log("[slack-adapter] Following redirect to CDN:", redirectUrl.split("?")[0]);

  // Follow the redirect WITHOUT the Authorization header
  return fetch(redirectUrl);
}

/**
 * Slack message event from Bolt (simplified interface for our needs)
 */
interface BoltMessageEvent {
  type: string;
  subtype?: string;
  text?: string;
  user?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  channel_type?: string;
  bot_id?: string;
  /** File attachments (for voice messages, images, etc.) */
  files?: SlackFile[];
}

/**
 * Slack app_mention event from Bolt
 */
interface BoltAppMentionEvent {
  type: string;
  text: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
}

/**
 * Slack channel adapter
 * Connects to Slack via Socket Mode and routes messages
 */
export class SlackAdapter implements ChannelAdapter {
  readonly type = "slack";
  readonly name = "Slack";

  private app: App;
  private config: SlackChannelConfig;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
  private _isConnected = false;
  private botUserId: string | null = null;

  constructor(config: SlackChannelConfig) {
    this.config = config;
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
      signingSecret: config.signingSecret,
      // Custom logger to suppress noisy pong timeout warnings
      logger: {
        debug: () => {},
        info: () => {},
        warn: (msg: string) => {
          // Suppress pong timeout warnings
          if (!msg.includes("pong") && !msg.includes("Pong")) {
            console.warn("[slack]", msg);
          }
        },
        error: (msg: string) => console.error("[slack]", msg),
        setLevel: () => {},
        getLevel: () => "warn" as any,
        setName: () => {},
      },
    });
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to Slack via Socket Mode
   */
  async connect(): Promise<void> {
    console.log("[slack-adapter] connect() called");

    // Get bot user ID for mention detection
    try {
      console.log("[slack-adapter] Calling auth.test()...");
      const authResult = await this.app.client.auth.test();
      this.botUserId = authResult.user_id as string;
      console.log(`[slack-adapter] auth.test() OK — bot: ${authResult.user} (${this.botUserId})`);
    } catch (error) {
      console.error("[slack-adapter] auth.test() failed:", error);
    }

    // Handle direct messages and channel messages
    this.app.message(async ({ message }) => {
      await this.handleMessage(message as BoltMessageEvent);
    });

    // Handle @mentions
    this.app.event("app_mention", async ({ event }) => {
      await this.handleMention(event as BoltAppMentionEvent);
    });

    // Start the app (Socket Mode)
    console.log("[slack-adapter] Calling app.start()...");
    await this.app.start();
    this._isConnected = true;
    console.log("[slack-adapter] app.start() OK — Socket Mode connected");
  }

  /**
   * Disconnect from Slack
   */
  async disconnect(): Promise<void> {
    await this.app.stop();
    this._isConnected = false;
    console.log("Slack adapter disconnected");
  }

  /**
   * Send a message to a Slack channel/thread
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    // Send attachments first (files)
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        await this.sendAttachment(message.channelId, attachment, message.threadId);
      }
    }

    // Send text message if present
    if (message.text?.trim()) {
      const formattedText = toSlackFormat(message.text);
      const chunks = chunkForSlack(formattedText);

      for (const chunk of chunks) {
        // Build params object - Slack Web API types are complex, use type assertion
        const params = {
          channel: message.channelId,
          text: chunk,
          ...(message.threadId && { thread_ts: message.threadId }),
          ...(message.broadcastToChannel && { reply_broadcast: message.broadcastToChannel }),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.app.client.chat.postMessage(params as any);
      }
    }
  }

  /**
   * Send a media attachment via file upload
   */
  private async sendAttachment(channelId: string, attachment: OutboundAttachment, threadTs?: string): Promise<void> {
    try {
      // Get file content
      let buffer: Buffer;
      if (attachment.content) {
        buffer = attachment.content;
      } else if (attachment.path) {
        buffer = await readMediaFile(attachment.path);
      } else if (attachment.url) {
        // Download from URL
        const response = await fetch(attachment.url);
        if (!response.ok) {
          console.warn("[slack-adapter] Failed to download attachment from URL:", attachment.url);
          return;
        }
        buffer = Buffer.from(await response.arrayBuffer());
      } else {
        console.warn("[slack-adapter] Attachment has no content, path, or URL");
        return;
      }

      // Determine filename
      const filename =
        attachment.name || (attachment.path ? attachment.path.split("/").pop() : undefined) || `file-${Date.now()}`;

      // Upload file using filesUploadV2
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.app.client.files as any).uploadV2({
        channel_id: channelId,
        file: buffer,
        filename,
        ...(threadTs && { thread_ts: threadTs }),
      });
    } catch (error) {
      console.error("[slack-adapter] Error sending attachment:", error);
    }
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Handle incoming message events
   */
  private async handleMessage(message: BoltMessageEvent): Promise<void> {
    console.log("[slack-adapter] handleMessage called:", {
      type: message.type,
      subtype: message.subtype,
      hasText: !!message.text,
      textPreview: message.text?.slice(0, 50),
      hasFiles: !!message.files?.length,
      fileCount: message.files?.length || 0,
      files: message.files?.map((f) => ({ id: f.id, name: f.name, mimetype: f.mimetype, subtype: f.subtype })),
      bot_id: message.bot_id,
      channel_type: message.channel_type,
    });

    // Ignore bot messages (including our own)
    if (message.bot_id) {
      console.log("[slack-adapter] Ignoring bot message");
      return;
    }

    // Check allowlist if configured
    if (this.config.allowFrom && this.config.allowFrom.length > 0) {
      const userId = message.user;
      const isAllowed = userId && this.config.allowFrom.includes(userId);

      if (!isAllowed) {
        console.warn(
          JSON.stringify({
            component: "gateway",
            level: "warn",
            message: "Blocked: user not in allowlist",
            userId,
            channel: "slack",
          }),
        );
        return;
      }
    }

    // Ignore message subtypes we don't handle (joins, leaves, etc.)
    // Allow: thread_broadcast, file_share (voice messages, images, etc.)
    if (message.subtype && !["thread_broadcast", "file_share"].includes(message.subtype)) {
      console.log("[slack-adapter] Ignoring message with subtype:", message.subtype);
      return;
    }

    // Check if this is a DM or if we should respond to all messages
    const isDM = message.channel_type === "im";
    if (!isDM && !this.config.respondToAllMessages) {
      console.log("[slack-adapter] Ignoring non-DM message (respondToAllMessages is false)");
      // Only respond to DMs unless configured otherwise
      // (mentions are handled by app_mention event)
      return;
    }

    const slackEvent: SlackMessageEvent = {
      type: message.type,
      subtype: message.subtype,
      text: message.text,
      user: message.user,
      channel: message.channel,
      ts: message.ts,
      thread_ts: message.thread_ts,
      channel_type: message.channel_type,
      files: message.files,
    };

    // Check if we have content (text or files)
    const hasFiles = message.files && message.files.length > 0;
    if (!message.text && !hasFiles) {
      console.log("[slack-adapter] Ignoring message with no text and no files");
      return;
    }

    console.log("[slack-adapter] Processing message - hasText:", !!message.text, "hasFiles:", hasFiles);

    // Get user info for better context
    const userInfo = await this.getUserInfo(message.user);

    const inbound = toInboundMessage(slackEvent, userInfo, this.botUserId || undefined);

    // Extract and attach media files
    if (hasFiles) {
      console.log("[slack-adapter] Extracting attachments from", message.files!.length, "files");
      const attachments = await this.extractAttachments(message.files!);
      console.log(
        "[slack-adapter] Extracted",
        attachments.length,
        "attachments:",
        attachments.map((a) => ({ type: a.type, path: a.path, mimeType: a.mimeType })),
      );
      if (attachments.length > 0) {
        inbound.attachments = attachments;
      }
    }

    console.log(
      "[slack-adapter] Sending to message handler - text:",
      inbound.text?.slice(0, 50),
      "attachments:",
      inbound.attachments?.length || 0,
    );

    if (this.messageHandler) {
      await this.messageHandler(inbound);
    }
  }

  /**
   * Handle @mention events
   */
  private async handleMention(event: BoltAppMentionEvent): Promise<void> {
    // Check allowlist if configured
    if (this.config.allowFrom && this.config.allowFrom.length > 0) {
      const userId = event.user;
      const isAllowed = this.config.allowFrom.includes(userId);

      if (!isAllowed) {
        console.warn(
          JSON.stringify({
            component: "gateway",
            level: "warn",
            message: "Blocked: mention from user not in allowlist",
            userId,
            channel: "slack",
          }),
        );
        return;
      }
    }

    const slackEvent: SlackMessageEvent = {
      type: "message",
      text: event.text,
      user: event.user,
      channel: event.channel,
      ts: event.ts,
      thread_ts: event.thread_ts,
    };

    const userInfo = await this.getUserInfo(event.user);
    const inbound = toInboundMessage(slackEvent, userInfo, this.botUserId || undefined);

    // Force isMention to true for app_mention events
    inbound.isMention = true;

    if (this.messageHandler) {
      await this.messageHandler(inbound);
    }
  }

  /**
   * Get user info from Slack API
   * Requires the `users:read` scope - gracefully falls back to just userId if not available
   */
  private async getUserInfo(userId?: string): Promise<{ id: string; name?: string; real_name?: string } | undefined> {
    if (!userId) return undefined;

    try {
      const result = await this.app.client.users.info({ user: userId });
      if (result.user) {
        return {
          id: result.user.id!,
          name: result.user.name,
          real_name: result.user.real_name,
        };
      }
    } catch (error: unknown) {
      // Handle missing_scope error silently - it's a known limitation
      // when users:read scope isn't configured
      const slackError = error as { data?: { error?: string } };
      if (slackError.data?.error === "missing_scope") {
        // Silently fall back to userId only - this is expected behavior
        // when users:read scope is not configured
        return { id: userId };
      }
      // Log other unexpected errors
      console.warn(`Failed to get user info for ${userId}:`, error);
    }

    return { id: userId };
  }

  /**
   * Download a file from Slack
   * Requires the `files:read` scope
   */
  private async downloadFile(file: SlackFile): Promise<InboundAttachment | null> {
    console.log("[slack-adapter] downloadFile called:", {
      id: file.id,
      name: file.name,
      mimetype: file.mimetype,
      filetype: file.filetype,
      subtype: file.subtype,
      size: file.size,
    });

    // First, get complete file info from Slack API (message event may have incomplete URLs)
    let fileInfo = file;
    try {
      const result = await this.app.client.files.info({ file: file.id });
      if (result.file) {
        fileInfo = result.file as unknown as SlackFile;
        console.log("[slack-adapter] Got full file info from API");
      }
    } catch (error) {
      console.warn("[slack-adapter] Could not get file info from API, using message data:", error);
    }

    // Log ALL available URLs to find the right one
    console.log("[slack-adapter] ALL URL options:", {
      url_private_download: fileInfo.url_private_download,
      url_private: fileInfo.url_private,
      mp4: fileInfo.mp4,
      aac: fileInfo.aac,
      hls: fileInfo.hls,
    });

    // For audio files, prefer aac or mp4 URLs if available (these are the actual audio)
    // url_private_download from files-tmb path returns sample/demo content
    let downloadUrl: string | undefined;

    if (fileInfo.subtype === "slack_audio" || fileInfo.mimetype?.startsWith("audio/")) {
      // For Slack audio/voice messages, try aac or mp4 first
      downloadUrl = fileInfo.aac || fileInfo.mp4 || fileInfo.url_private_download || fileInfo.url_private;
    } else {
      downloadUrl = fileInfo.url_private_download || fileInfo.url_private;
    }

    // If URL contains 'files-tmb' (thumbnail), try to construct the actual file URL
    // files-tmb URLs serve preview/sample content, not the actual file
    // Pattern: files-tmb/TEAM-FILE-HASH/filename -> files-pri/TEAM-FILE/filename
    if (downloadUrl?.includes("/files-tmb/")) {
      const tmbMatch = downloadUrl.match(/\/files-tmb\/([A-Z0-9]+)-([A-Z0-9]+)-[a-f0-9]+\//i);
      if (tmbMatch) {
        const [, teamId, fileId] = tmbMatch;
        // Construct the files-pri URL for the actual file
        const priUrl = `https://files.slack.com/files-pri/${teamId}-${fileId}/${fileInfo.name}`;
        console.log("[slack-adapter] Detected files-tmb URL, trying files-pri instead:", priUrl);
        downloadUrl = priUrl;
      }
    }

    console.log("[slack-adapter] Selected URL:", downloadUrl);
    if (!downloadUrl) {
      console.warn("[slack-adapter] File has no download URL:", file.id);
      return null;
    }

    console.log("[slack-adapter] Downloading from:", downloadUrl);

    try {
      // Slack files require authentication via Authorization header
      // Use fetchWithSlackAuth to handle cross-origin redirects properly
      const response = await fetchWithSlackAuth(downloadUrl, this.config.botToken);

      console.log("[slack-adapter] Download response:", response.status, response.statusText);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          "[slack-adapter] Failed to download file:",
          response.status,
          response.statusText,
          errorBody.slice(0, 200),
        );
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = fileInfo.mimetype || response.headers.get("content-type") || "application/octet-stream";

      console.log("[slack-adapter] Downloaded", buffer.length, "bytes, contentType:", contentType);

      // Warn if download size doesn't match expected size
      if (fileInfo.size && buffer.length !== fileInfo.size) {
        console.warn("[slack-adapter] SIZE MISMATCH! Expected:", fileInfo.size, "Got:", buffer.length);
      }

      const saved = await saveMediaBuffer(buffer, {
        mime: contentType,
        originalName: fileInfo.name,
        direction: "inbound",
      });

      console.log("[slack-adapter] Saved to:", saved.path, "kind:", saved.kind);

      // Determine attachment type from MIME or file type
      let type: InboundAttachment["type"] = saved.kind;

      // Slack voice messages have subtype 'slack_audio'
      if (fileInfo.subtype === "slack_audio" || fileInfo.filetype === "webm" || contentType.startsWith("audio/")) {
        type = "audio";
      } else if (contentType.startsWith("video/")) {
        type = "video";
      } else if (contentType.startsWith("image/")) {
        type = "image";
      }

      console.log("[slack-adapter] Final attachment type:", type);

      return {
        type,
        path: saved.path,
        mimeType: saved.mime,
        name: saved.originalName,
        size: saved.size,
        duration: fileInfo.duration_ms ? fileInfo.duration_ms / 1000 : undefined,
      };
    } catch (error) {
      console.error("[slack-adapter] Error downloading file:", error);
      return null;
    }
  }

  /**
   * Extract attachments from Slack message files
   */
  private async extractAttachments(files: SlackFile[]): Promise<InboundAttachment[]> {
    const attachments: InboundAttachment[] = [];

    for (const file of files) {
      const attachment = await this.downloadFile(file);
      if (attachment) {
        attachments.push(attachment);
      }
    }

    return attachments;
  }
}
