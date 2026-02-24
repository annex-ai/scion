# 🔒 Mastra Gateway Security Assessment

**Document Version:** 3.0
**Assessment Date:** 2026-02-24
**Scope:** Gateway server, input processors, output processors, authentication, network security, secret protection, SSRF protection, container hardening

---

## Executive Summary

This document provides a comprehensive security assessment of the Mastra-based gateway implementation, covering input/output processor hardening, gateway-level security, authentication mechanisms, network protection strategies, secret masking, SSRF mitigation, and container hardening.

### Current Security Posture (Updated 2026-02-24)

| Area | Status | Risk Level |
|------|--------|------------|
| Input Processors | ✅ Implemented (SecretMask + Unicode + Adversarial + PromptInjection) | Low |
| Output Processors | ✅ Implemented (SecretSanitizer + PII + BatchParts) | Low |
| Secret Protection | ✅ Implemented (input masking + output sanitization) | Low |
| SSRF Protection | ✅ Implemented (safe-fetch + MCP client) | Low |
| Gateway Inbound Security | ✅ Implemented (IP allow/deny lists, CIDR matching) | Low |
| Container Hardening | ✅ Implemented (non-root, read-only, cap-drop, resource limits) | Low |
| Authentication | ✅ Implemented (SimpleAuth) | Low |
| Rate Limiting | ✅ Implemented (in-memory, single-instance) | Low-Medium |

### Implemented

1. **DONE:** SimpleAuth added to Mastra server with GATEWAY_API_KEY
2. **DONE:** Authorization header added to gateway-to-Mastra HTTP calls
3. **DONE:** Input processor chain: SecretMask → UnicodeNormalizer → AdversarialPatternDetector → PromptInjectionDetector → Context → Skills
4. **DONE:** Output processor chain: SecretSanitizer → PIIDetector → BatchPartsProcessor
5. **DONE:** Slack allowlist support (type + config + enforcement)
6. **DONE:** Telegram allowlist logging on rejection
7. **DONE:** Rate limiting (per-session 30/min, per-user 50/min)
8. **DONE:** resource_id configured via agent.toml [security] section
9. **DONE:** Secret protection — masks env var values in input, sanitizes output before persistence
10. **DONE:** SSRF protection — blocks cloud metadata endpoints, validates redirects per-hop
11. **DONE:** Gateway inbound security — IP-based allow/deny with CIDR matching
12. **DONE:** Container hardening — non-root user, dropped capabilities, read-only rootfs, resource limits

### Remaining Gaps

1. **MEDIUM:** SystemPromptScrubber not enabled (deferred — adds LLM call per message)
2. **MEDIUM:** ModerationProcessor not enabled (deferred — adds LLM call per message)
3. **MEDIUM:** Rate limiter is in-memory only (lost on restart, single-instance)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL ATTACK SURFACE                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Slack  │  │ Telegram │  │ Discord  │  │ WhatsApp │  │   Other  │        │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       └─────────────┴─────────────┴─────────────┴─────────────┘              │
│                                    │                                         │
└────────────────────────────────────┼─────────────────────────────────────────┘
                                     │ WebSocket / HTTP
┌────────────────────────────────────┼─────────────────────────────────────────┐
│                         GATEWAY LAYER                                         │
│                                    │                                         │
│  ┌─────────────────────────────────▼──────────────────────────────────┐      │
│  │                    GatewayServer (gateway/server.ts)                │      │
│  │  • Channel adapter management                                       │      │
│  │  • Session persistence                                              │      │
│  │  • Message routing                                                  │      │
│  └─────────────────────────────────┬──────────────────────────────────┘      │
│                                    │ HTTP POST                               │
│  ┌─────────────────────────────────▼──────────────────────────────────┐      │
│  │              GatewayToMastraAdapter (gateway/adapter.ts)            │      │
│  │  • Session key generation                                           │      │
│  │  • Request context setup                                            │      │
│  │  • HTTP communication with Mastra                                   │      │
│  └─────────────────────────────────┬──────────────────────────────────┘      │
│                                    │                                         │
└────────────────────────────────────┼─────────────────────────────────────────┘
                                     │ HTTP /api/agents/interactiveAgent/generate
┌────────────────────────────────────┼─────────────────────────────────────────┐
│                         MASTRA LAYER                                          │
│                                    │                                         │
│  ┌─────────────────────────────────▼──────────────────────────────────┐      │
│  │                    Interactive Agent                                │      │
│  │  ┌─────────────────────────────────────────────────────────────┐   │      │
│  │  │              INPUT PROCESSOR CHAIN                          │   │      │
│  │  │  0. SecretMaskProcessor ✅ (zero-cost, masks env secrets)   │   │      │
│  │  │  1. UnicodeNormalizer ✅ (zero-cost)                        │   │      │
│  │  │  2. AdversarialPatternDetector ✅ (custom, zero-cost regex) │   │      │
│  │  │  3. PromptInjectionDetector ✅ (LLM-based, ~1 call/msg)    │   │      │
│  │  │  4. Context Processors ✅ (compaction, token mgmt)          │   │      │
│  │  │  5. SkillsProcessor ✅                                      │   │      │
│  │  └─────────────────────────────────────────────────────────────┘   │      │
│  │                                                                    │      │
│  │  ┌─────────────────────────────────────────────────────────────┐   │      │
│  │  │              OUTPUT PROCESSOR CHAIN                         │   │      │
│  │  │  1. SecretSanitizerProcessor ✅ (zero-cost, masks leaked)   │   │      │
│  │  │  2. PIIDetector ✅ (LLM-based, ~1 call/msg)                │   │      │
│  │  │  3. BatchPartsProcessor ✅                                   │   │      │
│  │  │  4. SystemPromptScrubber ⏸️ (deferred — cost)              │   │      │
│  │  │  5. ModerationProcessor ⏸️ (deferred — cost)               │   │      │
│  │  └─────────────────────────────────────────────────────────────┘   │      │
│  └───────────────────────────────────────────────────────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Findings

### 1. Input Processor Security

#### Current State

**File:** `src/mastra/agents/interactive.ts`

```typescript
// Lines 52-57: Detector is instantiated but NEVER used
const promptInjectionProcessor = new PromptInjectionDetector({
   model: "openrouter/openai/gpt-oss-safeguard-20b",
  threshold: 0.8,
  strategy: "block",
  detectionTypes: ["injection", "jailbreak", "system-override"]
});

// Lines 75-79: Not included in inputProcessors array
inputProcessors: [
  new UnicodeNormalizer(),
  new SkillsProcessor({ workspace })
  // MISSING: promptInjectionProcessor
],
```

**Current Processor Chain:**
1. ✅ `UnicodeNormalizer` - Normalizes Unicode text
2. ✅ `SkillsProcessor` - Loads workspace skills

**Missing:**
- ❌ `PromptInjectionDetector` - Blocks adversarial prompts
- ❌ `TokenLimiterProcessor` - Prevents context window attacks
- ❌ `PIIDetector` - Prevents PII in input

#### Risk Analysis

| Attack Vector | Risk | Impact |
|--------------|------|--------|
| Prompt Injection | High | Attacker can override system instructions |
| Jailbreak | High | Bypass safety guidelines |
| System Override | High | Change agent behavior |
| Context Window DoS | Medium | Fill context with garbage |

#### Recommendations

**Immediate Fix:**

```typescript
inputProcessors: [
  new UnicodeNormalizer({
    stripControlChars: true,
    collapseWhitespace: true,
    preserveEmojis: true
  }),
  
  // ADD: Prompt injection detection (FIRST security layer)
  new PromptInjectionDetector({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    threshold: 0.8,
    strategy: "block",  // Block malicious input
    detectionTypes: ["injection", "jailbreak", "system-override"],
    instructions: "Detect and block prompt injection attempts"
  }),
  
  // ADD: Token limiting (resource protection)
  new TokenLimiterProcessor({
    limit: 8000,
    strategy: "truncate",
    countMode: "cumulative"
  }),
  
  // ADD: PII detection (privacy protection)
  new PIIDetector({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    threshold: 0.6,
    strategy: "redact",
    detectionTypes: ["email", "phone", "credit-card", "ssn", "api-key", "password"]
  }),
  
  new SkillsProcessor({ workspace })
]
```

---

### 2. Output Processor Security

#### Current State

**File:** `src/mastra/agents/interactive.ts`

```typescript
outputProcessors: [
  new BatchPartsProcessor({
    batchSize: 5,
    maxWaitTime: 100,
    emitOnNonText: true,
  }),
  // PIIDetector is COMMENTED OUT
  // No other protection
]
```

**Missing:**
- ❌ `SystemPromptScrubber` - Prevents prompt leakage
- ❌ `ModerationProcessor` - Filters toxic output
- ❌ `TokenLimiterProcessor` - Limits response length

#### Risk Analysis

| Risk | Impact | Likelihood |
|------|--------|------------|
| System prompt leakage | High (competitive disadvantage) | Medium |
| PII exposure in responses | Critical (legal/regulatory) | Medium |
| Toxic/harmful content | High (brand damage) | Low |
| Excessive token usage | Medium (cost overrun) | High |

#### Recommendations

```typescript
outputProcessors: [
  // Batch for efficiency
  new BatchPartsProcessor({
    batchSize: 5,
    maxWaitTime: 100,
    emitOnNonText: true,
  }),
  
  // ADD: Response length limiting
  new TokenLimiterProcessor({
    limit: 2000,
    strategy: "truncate",
    countMode: "cumulative"
  }),
  
  // ADD: System prompt leak prevention
  new SystemPromptScrubber({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    strategy: "redact",
    customPatterns: [
      "Ralph Loop State",
      "## Flow",
      "## Orchestration Model",
      "## Self-Directed Task Management"
    ],
    redactionMethod: "placeholder",
    placeholderText: "[REDACTED]"
  }),
  
  // ADD: Content moderation
  new ModerationProcessor({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    threshold: 0.7,
    strategy: "block",
    categories: ["hate", "harassment", "violence", "self-harm"]
  }),
  
  // ENABLE: PII redaction
  new PIIDetector({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    threshold: 0.6,
    strategy: "redact",
    redactionMethod: "mask",
    detectionTypes: ["email", "phone", "credit-card", "ssn", "api-key", "password"]
  })
]
```

---

### 3. Custom Adversarial Pattern Detection (IMPLEMENTED)

> **Important**: `AdversarialPatternDetector` is **custom code** — NOT a built-in Mastra import. It lives at `src/mastra/processors/adversarial-detector.ts` and must be imported from there.

#### Rationale

While LLM-based detectors catch sophisticated attacks, simple pattern matching provides:
- **Zero-latency** detection
- **Deterministic** behavior
- **No additional cost** (no LLM calls)

#### Implementation

**File:** `src/mastra/processors/adversarial-detector.ts`

Implements the `Processor<"adversarial-detector">` interface from `@mastra/core/processors`. Uses regex patterns to detect common adversarial attacks (prompt injection, role manipulation, jailbreaking, system prompt extraction, delimiter attacks).

**Current input processor chain:**

```typescript
inputProcessors: [
  new UnicodeNormalizer(),              // 1. Normalize text (zero-cost)
  new AdversarialPatternDetector(),     // 2. Fast regex check (zero-cost) — CUSTOM CODE
  promptInjectionProcessor,              // 3. LLM-based detection (~1 call/msg)
  new SkillsProcessor({ workspace }),    // 4. Skills loading
]
```

---

### 4. Gateway Authentication

#### Current State

**Problem:** Gateway makes HTTP calls to Mastra server without authentication:

```typescript
// src/mastra/gateway/adapter.ts (callAgentViaHttp)
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // NO AUTHENTICATION HEADER
  },
  body: JSON.stringify({ ... }),
});
```

Any process on localhost can access the Mastra agent API.

#### Recommended Solution: SimpleAuth

**Step 1:** Add auth to Mastra server (`src/mastra/client.ts`)

```typescript
import { SimpleAuth } from '@mastra/core/server';

export const mastra = new Mastra({
  // ... existing config
  server: {
    // ... existing middleware/apiRoutes
    auth: new SimpleAuth({
      tokens: {
        [process.env.GATEWAY_API_KEY!]: {
          id: 'gateway-service',
          name: 'Gateway Service Account',
          role: 'service',
        },
      },
      public: ['/_gateway/health', '/_skills/status'],
    }),
  },
});
```

**Step 2:** Add API key to gateway adapter (`src/mastra/gateway/adapter.ts`)

```typescript
private async callAgentViaHttp(...) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GATEWAY_API_KEY || ''}`,
    },
    body: JSON.stringify({ ... }),
  });
}
```

**Step 3:** Add to environment

```bash
# .env
GATEWAY_API_KEY=gateway_sk_live_$(openssl rand -hex 32)
```

---

### 5. Channel Allowlist Enforcement

#### Current State

**File:** `src/mastra/gateway/channels/types.ts`

Channel configs include `allowFrom` fields:

```typescript
interface TelegramChannelConfig extends ChannelConfig {
  allowFrom?: Array<string | number>;  // Defined but NOT enforced
}

interface DiscordChannelConfig extends ChannelConfig {
  allowFrom?: Array<string | number>;  // Defined but NOT enforced
}
```

**Problem:** No channel adapter checks the allowlist before processing messages.

#### Recommended Fix

**For Telegram** (`src/mastra/gateway/channels/telegram/adapter.ts`):

```typescript
private async handleMessage(message: TelegramMessage): Promise<void> {
  // Check allowlist
  if (this.config.allowFrom?.length) {
    const senderId = message.from?.id?.toString();
    const senderUsername = message.from?.username;
    
    const isAllowed = this.config.allowFrom.some(
      allowed => allowed === senderId || allowed === senderUsername
    );
    
    if (!isAllowed) {
      logger.warn({ 
        senderId, 
        senderUsername,
        channel: 'telegram'
      }, 'Message from unauthorized user dropped');
      return; // Silently drop
    }
  }
  
  // ... rest of handling
}
```

**Similar fixes needed for:** Discord, WhatsApp, Signal adapters.

---

### 6. Rate Limiting

#### Current State

No rate limiting exists. Attackers can:
- Flood gateway with messages
- Cause excessive LLM API costs
- Exhaust context windows
- Trigger rate limits on downstream services

#### Recommended Implementation

**File:** `src/mastra/gateway/server.ts`

```typescript
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class GatewayServer {
  private rateLimiter = new Map<string, RateLimitEntry>();
  
  // Configuration
  private readonly rateLimitWindowMs = 60000; // 1 minute
  private readonly rateLimitMaxRequests = 30; // per minute
  
  private async checkRateLimit(sessionKey: string): Promise<boolean> {
    const now = Date.now();
    const entry = this.rateLimiter.get(sessionKey);
    
    if (!entry || now > entry.resetTime) {
      this.rateLimiter.set(sessionKey, {
        count: 1,
        resetTime: now + this.rateLimitWindowMs
      });
      return true;
    }
    
    if (entry.count >= this.rateLimitMaxRequests) {
      return false;
    }
    
    entry.count++;
    return true;
  }
  
  private async handleMessage(
    channel: ChannelAdapter,
    message: InboundMessage
  ): Promise<void> {
    const sessionKey = createSessionKey(
      message.channelType,
      message.channelId,
      message.threadId
    );
    
    // Rate limit check
    if (!await this.checkRateLimit(sessionKey)) {
      logger.warn({ sessionKey, channel: channel.name }, 'Rate limit exceeded');
      await channel.sendMessage({
        text: "⚠️ Rate limit exceeded. Please slow down.",
        channelId: message.channelId,
        threadId: message.threadId || message.id,
      });
      return;
    }
    
    // ... rest of handling
  }
}
```

---

### 7. Network Security Options

#### Option A: Tailscale (Recommended for Internal)

Best for corporate/internal deployments.

```typescript
// src/mastra/gateway/server.ts
import { isTailscaleIP } from './utils/network';

private async handleMessage(channel: ChannelAdapter, message: InboundMessage): Promise<void> {
  // Enforce Tailscale-only access
  if (process.env.REQUIRE_TAILSCALE === 'true') {
    const senderIP = (message.raw as any)?.user?.ip_address;
    if (senderIP && !isTailscaleIP(senderIP)) {
      logger.warn({ senderIP }, 'Non-Tailscale connection rejected');
      return;
    }
  }
  // ...
}
```

**Setup:**
1. Install Tailscale on gateway host
2. Set `REQUIRE_TAILSCALE=true` in environment
3. Share Tailscale IP with authorized users only

---

#### Option B: IP Whitelisting

Best for fixed-location deployments.

```typescript
// src/mastra/gateway/config/schema.ts
export interface GatewayConfig {
  ipWhitelist?: string[]; // CIDR notation
}

// src/mastra/gateway/server.ts
import { isIPInCIDR } from './utils/ip';

private isIPAllowed(ip: string): boolean {
  if (!this.config.ipWhitelist?.length) return true;
  return this.config.ipWhitelist.some(cidr => isIPInCIDR(ip, cidr));
}
```

---

#### Option C: Cloudflare Access

Best for public-facing with SSO.

```typescript
// For HTTP-based webhooks
private async verifyCloudflareAccess(message: InboundMessage): Promise<boolean> {
  const cfToken = (message.raw as any)?.headers?.['cf-access-jwt-assertion'];
  if (!cfToken) return false;
  
  const response = await fetch(
    `https://${process.env.CF_TEAM_DOMAIN}/cdn-cgi/access/get-identity`,
    { headers: { 'CF-Access-JWT-Assertion': cfToken } }
  );
  
  return response.ok;
}
```

---

### 8. Secret Protection (IMPLEMENTED)

Secret protection prevents API keys, tokens, and other environment variable values from leaking into LLM context, message history, tool arguments, or observability traces.

#### Architecture

The system uses a two-layer approach:

1. **Input: SecretMaskProcessor** — Runs as the **first** input processor (before all others). Scans user messages for values matching known environment variables and replaces them with `§§secret(ALIAS)` tokens. The LLM never sees the real secret.

2. **Output: SecretSanitizerProcessor** — Runs as the **first** output processor (before PII detection). Catches any secrets that may have leaked through tool results or edge cases before messages are persisted to storage.

#### How It Works

**Files:**
- `src/mastra/processors/secret-mask-processor.ts` — Input processor
- `src/mastra/processors/secret-sanitizer-processor.ts` — Output processor
- `src/mastra/lib/secrets/utils.ts` — Core scanning and masking logic

**Secret detection:** On startup, the utils module loads all environment variables from `.env` and `process.env`. It filters for high-entropy values (API keys, tokens) using a known-key list (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, etc.) and heuristic length/pattern checks.

**Masking pattern:** `§§secret(ENV_VAR_NAME)` — visually distinctive, safe for LLM context, and reversible for debugging.

#### Configuration

Controlled via `agent.toml`:

```toml
[security]
enableSecretProtection = true  # default: true
```

#### Verification

Send a message containing a real API key value from `.env`. The LLM response should reference `§§secret(OPENAI_API_KEY)` instead of the raw key. Check logs for `[secret-mask]` processor activity.

---

### 9. SSRF Protection (IMPLEMENTED)

SSRF (Server-Side Request Forgery) protection prevents the agent's tools from being used to access internal network services, cloud metadata endpoints, or other restricted URLs.

#### Architecture

Two integration points:

1. **Web Fetch Tool** (`src/mastra/tools/web-fetch.ts`) — Uses `safeFetch()` instead of bare `fetch()`. Each request and each redirect hop is validated before the connection is made.

2. **MCP Client** (`src/mastra/mcp_client.ts`) — URL-based MCP server connections use `createSafeFetch()` to validate URLs before connecting.

#### How It Works

**Files:**
- `src/mastra/lib/security/safe-fetch.ts` — `safeFetch()` and `createSafeFetch()` wrappers
- `src/mastra/lib/security/ssrf-validator.ts` — URL validation logic
- `src/mastra/lib/security/cidr-utils.ts` — Shared CIDR parsing and matching

**Default mode (permissive):** Allows all URLs **except** cloud metadata endpoints:
- `169.254.169.254/32` (AWS/GCP/Azure metadata)
- `100.100.100.200/32` (Alibaba metadata)
- `metadata.google.internal`
- `metadata.oraclecloud.com`

**Strict mode:** Only allows URLs matching a whitelist. Enabled by setting `strict: true` in the SSRF config.

**Redirect safety:** `safeFetch()` handles redirects manually (`redirect: "manual"`), validating each redirect location before following it. This prevents redirect-based SSRF bypasses (e.g., `attacker.com` → `169.254.169.254`).

**Error handling:** Blocked requests throw a `SecurityError` (name: `"SecurityError"`), which the web-fetch tool catches and returns as a structured error message to the agent.

#### Configuration

SSRF strict mode can be configured in `agent.toml` (currently permissive by default):

```toml
# [security.ssrf]
# strict = false          # Set to true for whitelist mode
# blockMetadata = true    # Always block cloud metadata (default)
# whitelist = [           # Only used when strict = true
#   "https://api.openai.com",
#   "https://api.anthropic.com",
# ]
# blockedHosts = []       # Additional hostnames to block
```

#### Verification

Use the web-fetch tool to request `http://169.254.169.254/latest/meta-data/`. Should return an error: `"SSRF blocked: Blocked metadata IP: 169.254.169.254"`.

---

### 10. Gateway Inbound Security (IMPLEMENTED)

IP-based access control for incoming HTTP requests to the Mastra server. Runs as middleware before authentication and request routing.

#### Architecture

**Files:**
- `src/mastra/gateway/security/validator.ts` — `GatewaySecurityValidator` class
- `src/mastra/gateway/security/ip-extractor.ts` — `extractClientIp()` function
- `src/mastra/gateway/security/index.ts` — Barrel export
- `src/mastra/lib/security/cidr-utils.ts` — Shared CIDR parsing (also used by SSRF)

**Integration point:** `src/mastra/client.ts` — Gateway security middleware runs as the **first** middleware in the Mastra server stack, before the request context extraction middleware.

#### How It Works

1. **IP Extraction:** `extractClientIp()` reads the client IP from request headers. When `trust_proxy` is enabled, it parses `X-Forwarded-For` (walking backwards to skip trusted proxies) and falls back to `X-Real-IP`.

2. **Validation:** `GatewaySecurityValidator.validateRequest(ip)` applies rules in order:
   - **Deny list** checked first — always blocks matching IPs (highest priority)
   - **Allow list** checked second — if default policy is `deny`, IP must match the allow list
   - Supports both exact IPs and CIDR ranges (e.g., `192.168.1.0/24`, `10.0.0.0/8`)

3. **Response:** Blocked requests receive `403 Forbidden` with a JSON body `{ "error": "Forbidden" }`. A warning is logged: `[gateway-security] Blocked <ip>: <reason>`.

**Lazy activation:** The validator is only instantiated if the config has a non-empty deny list, a non-empty allow list, or `default_policy: "deny"`. With default settings (empty lists, policy `allow`), no validation runs and there is zero overhead.

#### Configuration

```toml
[gateway.security]
default_policy = "allow"     # "allow" or "deny"
whitelist_ips = []            # IPs/CIDRs always allowed
blacklist_ips = []            # IPs/CIDRs always blocked
trust_proxy = false           # Trust X-Forwarded-For header
trusted_proxies = []          # Proxy IPs to skip in XFF chain
```

**Example — block specific IPs:**
```toml
[gateway.security]
default_policy = "allow"
blacklist_ips = ["1.2.3.4", "10.0.0.0/8"]
```

**Example — allowlist mode (deny by default):**
```toml
[gateway.security]
default_policy = "deny"
whitelist_ips = ["192.168.1.0/24", "10.10.0.5"]
trust_proxy = true
trusted_proxies = ["172.17.0.1"]
```

#### Verification

Enable `[gateway.security]` in `agent.toml` with a deny list entry matching your IP. Restart and send a request. Check for a `403` response and `[gateway-security] Blocked` in the logs.

---

### 11. Container Hardening (IMPLEMENTED)

Defense-in-depth at the container layer, reducing the blast radius if the application is compromised.

#### Dockerfile (`Dockerfile`)

- **Non-root user:** Application runs as `appuser` (UID/GID created via `groupadd`/`useradd`), not root
- **Minimal packages:** Only `libvips-dev`, `curl`, and `ca-certificates` installed
- **Writable directories:** Only `/app/.agent/data` and `/app/.tmp` are writable by `appuser`

#### Docker Compose (`docker-compose.yml`)

| Setting | Value | Purpose |
|---------|-------|---------|
| `cap_drop: [ALL]` | Drop all Linux capabilities | Minimize kernel attack surface |
| `cap_add: [CHOWN, SETGID, SETUID]` | Re-add only needed caps | Required for bun runtime |
| `read_only: true` | Read-only root filesystem | Prevents filesystem modification by attacker |
| `security_opt: [no-new-privileges:true]` | No privilege escalation | Blocks setuid/setgid binaries |
| `mem_limit: 2g` | 2GB memory limit | Prevents memory exhaustion DoS |
| `cpus: '1.5'` | 1.5 CPU cores | Prevents CPU exhaustion |
| `pids_limit: 100` | Max 100 processes | Prevents fork bombs |
| `tmpfs: /tmp:size=100M` | Tmpfs for /tmp | Writable temp without persisting to disk |

#### Verification

```bash
docker compose build && docker compose up -d
docker compose exec scion whoami          # → appuser
docker compose exec scion touch /test     # → Permission denied (read-only fs)
docker compose exec scion touch /tmp/test # → OK (tmpfs writable)
```

---

## Implementation Roadmap

### Phase 1: Critical (Week 1)

| Task | File | Effort | Priority |
|------|------|--------|----------|
| Add PromptInjectionDetector to inputProcessors | `interactive.ts` | 5 min | 🔴 Critical |
| Create AdversarialPatternDetector | New file | 30 min | 🔴 Critical |
| Add SimpleAuth to Mastra server | `client.ts` | 15 min | 🔴 Critical |
| Add API key to HTTP calls | `adapter.ts` | 10 min | 🔴 Critical |

### Phase 2: High Priority (Week 2)

| Task | File | Effort | Priority |
|------|------|--------|----------|
| Enable PIIDetector on output | `interactive.ts` | 10 min | 🟡 High |
| Add SystemPromptScrubber | `interactive.ts` | 15 min | 🟡 High |
| Add TokenLimiterProcessor | `interactive.ts` | 10 min | 🟡 High |
| Enforce channel allowlists | Channel adapters | 1 hour | 🟡 High |
| Implement rate limiting | `server.ts` | 1 hour | 🟡 High |

### Phase 3: Medium Priority (Week 3-4)

| Task | File | Effort | Priority |
|------|------|--------|----------|
| Setup Tailscale for gateway host | Infrastructure | 2 hours | 🟢 Medium |
| Add audit logging | Multiple | 2 hours | 🟢 Medium |
| Implement message size limits | `adapter.ts` | 30 min | 🟢 Medium |
| Add content-type validation | `media/parse.ts` | 30 min | 🟢 Medium |

---

## Processor Pipeline (Final Recommended State)

### Input Processors

```typescript
inputProcessors: [
  // 1. Normalization
  new UnicodeNormalizer({
    stripControlChars: true,
    collapseWhitespace: true,
    preserveEmojis: true
  }),
  
  // 2. Size protection (early fail)
  new TokenLimiterProcessor({
    limit: 8000,
    strategy: "truncate",
    countMode: "cumulative"
  }),
  
  // 3. Security - Pattern detection (fast)
  new AdversarialPatternDetector(),
  
  // 4. Security - LLM-based detection
  new PromptInjectionDetector({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    threshold: 0.8,
    strategy: "block",
    detectionTypes: ["injection", "jailbreak", "system-override"],
    includeScores: true
  }),
  
  // 5. Privacy - Input sanitization
  new PIIDetector({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    threshold: 0.6,
    strategy: "redact",
    redactionMethod: "mask",
    detectionTypes: ["email", "phone", "credit-card", "ssn", "api-key", "password"],
    instructions: "Detect and mask PII and sensitive credentials"
  }),
  
  // 6. Skills loading
  new SkillsProcessor({ workspace })
]
```

### Output Processors

```typescript
outputProcessors: [
  // 1. Batching for efficiency
  new BatchPartsProcessor({
    batchSize: 5,
    maxWaitTime: 100,
    emitOnNonText: true,
  }),
  
  // 2. Response length limiting
  new TokenLimiterProcessor({
    limit: 2000,
    strategy: "truncate",
    countMode: "cumulative"
  }),
  
  // 3. Content moderation
  new ModerationProcessor({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    threshold: 0.7,
    strategy: "block",
    categories: ["hate", "harassment", "violence", "self-harm"],
    includeScores: true
  }),
  
  // 4. System prompt leak prevention
  new SystemPromptScrubber({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    strategy: "redact",
    customPatterns: [
      "Ralph Loop State",
      "## Flow",
      "## Orchestration Model",
      "## Self-Directed Task Management",
      "## Decision Authority",
      "## Orchestration Control Signal"
    ],
    redactionMethod: "placeholder",
    placeholderText: "[REDACTED]",
    includeDetections: true
  }),
  
  // 5. PII redaction
  new PIIDetector({
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    threshold: 0.6,
    strategy: "redact",
    redactionMethod: "mask",
    detectionTypes: ["email", "phone", "credit-card", "ssn", "api-key", "password"],
    instructions: "Detect and mask PII in model responses"
  })
]
```

---

## Environment Configuration

```bash
# .env - Security Configuration

# ============================================
# GATEWAY AUTHENTICATION
# ============================================
GATEWAY_API_KEY=gateway_sk_live_$(openssl rand -hex 32)

# ============================================
# NETWORK SECURITY (Choose one)
# ============================================
# Option A: Tailscale
REQUIRE_TAILSCALE=true
# TAILSCALE_API_KEY=tskey-api-...

# Option B: IP Whitelist (comma-separated CIDR)
# IP_WHITELIST=192.168.1.0/24,10.0.0.0/8

# Option C: Cloudflare Access
# CF_TEAM_DOMAIN=myteam.cloudflareaccess.com

# ============================================
# RATE LIMITING
# ============================================
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30

# ============================================
# MESSAGE LIMITS
# ============================================
MAX_MESSAGE_LENGTH=10000
MAX_ATTACHMENT_SIZE=10485760  # 10MB
```

---

## Security Checklist

### Pre-Deployment

- [x] PromptInjectionDetector added to inputProcessors
- [x] AdversarialPatternDetector implemented (custom code at `src/mastra/processors/adversarial-detector.ts`)
- [x] PIIDetector enabled on output
- [x] SecretMaskProcessor added as first input processor
- [x] SecretSanitizerProcessor added as first output processor
- [x] SSRF protection via safeFetch in web-fetch tool
- [x] SSRF protection via createSafeFetch in MCP client
- [x] Gateway inbound security middleware (IP allow/deny)
- [x] Container hardening (non-root, cap-drop, read-only, resource limits)
- [ ] SystemPromptScrubber added to outputProcessors (deferred — cost)
- [ ] TokenLimiterProcessor configured (optional)
- [x] SimpleAuth configured with strong API key
- [x] Gateway adapter includes Authorization header
- [x] Channel allowlists enforced (Slack + Telegram)
- [x] Rate limiting implemented (in-memory)
- [ ] Audit logging enabled
- [ ] Environment variables secured (not in git)
- [ ] API keys rotated

### Post-Deployment

- [ ] Test secret masking (send API key value, verify masked in response)
- [ ] Test SSRF blocking (fetch cloud metadata URL, verify SecurityError)
- [ ] Test gateway IP blocking (add IP to deny list, verify 403)
- [ ] Verify container runs as non-root (`whoami` → `appuser`)
- [ ] Test adversarial prompt detection
- [ ] Test PII redaction
- [ ] Verify rate limiting works
- [ ] Confirm unauthorized IPs/channels rejected
- [ ] Check audit logs are recording
- [ ] Validate system prompt not leaked
- [ ] Test with security scanning tools (gitleaks, etc.)

---

## LLM Processor Cost Impact

Each LLM-based processor adds an API call **per message**. Current enabled processors add **~2 extra LLM calls per message**:

| Processor | Location | LLM Calls | Status |
|-----------|----------|-----------|--------|
| SecretMaskProcessor | Input | 0 (regex) | Enabled |
| AdversarialPatternDetector | Input | 0 (regex) | Enabled |
| PromptInjectionDetector | Input | ~1 | Enabled |
| SecretSanitizerProcessor | Output | 0 (regex) | Enabled |
| PIIDetector | Output | ~1 | Enabled |
| SystemPromptScrubber | Output | ~1 | **Deferred** |
| ModerationProcessor | Output | ~1 | **Deferred** |

Secret protection and SSRF validation add **zero LLM cost** — they use regex matching and DNS lookups only. If all LLM-based processors were enabled, each message would incur **~4 extra LLM calls** (3-5x cost multiplier depending on model pricing). Enable incrementally and monitor costs.

## Rate Limiter Production Notes

The current rate limiter is Map-based (in-memory, single-instance):
- State is **lost on restart**
- **Not distributed** — won't work across multiple server instances
- Cleanup runs every 5 minutes to prevent memory leaks
- For production: replace with Redis-backed limiter using `Bun.redis`

---

## References

- [Mastra Guardrails Documentation](https://mastra.ai/docs/agents/guardrails)
- [Mastra Processors Reference](https://mastra.ai/docs/agents/processors)
- [Mastra Auth Providers](https://mastra.ai/docs/server/auth)
- [OWASP LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)

---

## Document Maintenance

- **Review Cycle:** Quarterly or after security incidents
- **Owner:** Security/Platform team
- **Last Updated:** 2026-02-24
- **Next Review:** 2026-05-24
