// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Instructions Builder
 *
 * Converts parsed soul configuration into system instructions for the agent.
 * Combines identity, soul, and user context into a coherent prompt.
 */

import type { IdentityConfig } from "../parsers/identity-parser";
import type { SoulConfig } from "../parsers/soul-parser";
import type { UserConfig } from "../parsers/user-parser";
import { getTimeBasedGreeting } from "../parsers/user-parser";

/**
 * Combined soul configuration from all parser outputs
 */
export interface CombinedSoulConfig {
  identity?: IdentityConfig;
  soul?: SoulConfig;
  user?: UserConfig;
}

/**
 * Options for building instructions
 */
export interface BuildInstructionsOptions {
  /** Include identity section */
  includeIdentity?: boolean;
  /** Include soul section */
  includeSoul?: boolean;
  /** Include user section */
  includeUser?: boolean;
  /** Include time-based greeting */
  includeGreeting?: boolean;
  /** Custom preamble text */
  preamble?: string;
  /** Custom epilogue text */
  epilogue?: string;
}

const DEFAULT_OPTIONS: BuildInstructionsOptions = {
  includeIdentity: true,
  includeSoul: true,
  includeUser: true,
  includeGreeting: true,
};

/**
 * Build system instructions from soul configuration
 */
export function buildSystemInstructions(config: CombinedSoulConfig, options: BuildInstructionsOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sections: string[] = [];

  // Add custom preamble if provided
  if (opts.preamble) {
    sections.push(opts.preamble);
  }

  // Build identity section
  if (opts.includeIdentity && config.identity) {
    const identitySection = buildIdentitySection(config.identity);
    if (identitySection) {
      sections.push(identitySection);
    }
  }

  // Build soul section
  if (opts.includeSoul && config.soul) {
    const soulSection = buildSoulSection(config.soul);
    if (soulSection) {
      sections.push(soulSection);
    }
  }

  // Build user section
  if (opts.includeUser && config.user) {
    const userSection = buildUserSection(config.user, opts.includeGreeting);
    if (userSection) {
      sections.push(userSection);
    }
  }

  // Add custom epilogue if provided
  if (opts.epilogue) {
    sections.push(opts.epilogue);
  }

  return sections.filter(Boolean).join("\n\n---\n\n");
}

/**
 * Build identity section of instructions
 */
function buildIdentitySection(identity: IdentityConfig): string {
  const lines: string[] = [];

  lines.push("## Identity");
  lines.push("");

  if (identity.name) {
    lines.push(`You are **${identity.name}**${identity.emoji ? ` ${identity.emoji}` : ""}.`);
  }

  if (identity.creature) {
    lines.push(`You are a ${identity.creature}.`);
  }

  if (identity.vibe) {
    lines.push(`Your vibe: ${identity.vibe}`);
  }

  if (identity.description) {
    lines.push("");
    lines.push(identity.description);
  }

  if (identity.voice) {
    lines.push("");
    lines.push("### Voice");
    lines.push(identity.voice);
  }

  return lines.join("\n");
}

/**
 * Build soul section of instructions
 */
function buildSoulSection(soul: SoulConfig): string {
  const lines: string[] = [];

  lines.push("## Soul");
  lines.push("");

  if (soul.coreTruths.length > 0) {
    lines.push("### Core Truths");
    for (const truth of soul.coreTruths) {
      lines.push(`- ${truth}`);
    }
    lines.push("");
  }

  if (soul.boundaries.length > 0) {
    lines.push("### Boundaries");
    for (const boundary of soul.boundaries) {
      lines.push(`- ${boundary}`);
    }
    lines.push("");
  }

  if (soul.vibe) {
    lines.push("### Vibe");
    lines.push(soul.vibe);
    lines.push("");
  }

  if (soul.continuity) {
    lines.push("### Continuity");
    lines.push(soul.continuity);
  }

  return lines.join("\n");
}

/**
 * Build user section of instructions
 */
function buildUserSection(user: UserConfig, includeGreeting = true): string {
  const lines: string[] = [];

  lines.push("## User Context");
  lines.push("");

  if (includeGreeting && user.name) {
    const greeting = getTimeBasedGreeting(user);
    lines.push(`*${greeting}*`);
    lines.push("");
  }

  lines.push(`**User**: ${user.name}`);

  if (user.pronouns) {
    lines.push(`**Pronouns**: ${user.pronouns}`);
  }

  lines.push(`**Timezone**: ${user.timezone}`);
  lines.push("");

  if (user.preferences.length > 0) {
    lines.push("### Preferences");
    for (const pref of user.preferences) {
      lines.push(`- ${pref}`);
    }
    lines.push("");
  }

  if (user.context) {
    lines.push("### Context");
    lines.push(user.context);
    lines.push("");
  }

  if (user.goals.length > 0) {
    lines.push("### Current Goals");
    for (const goal of user.goals) {
      lines.push(`- ${goal}`);
    }
  }

  return lines.join("\n");
}

/**
 * Build a minimal identity string (for use in shorter contexts)
 */
export function buildMinimalIdentity(config: CombinedSoulConfig): string {
  const parts: string[] = [];

  if (config.identity) {
    const { name, emoji, creature } = config.identity;
    if (name) {
      parts.push(`You are ${name}${emoji ? ` ${emoji}` : ""}`);
      if (creature) {
        parts.push(`(a ${creature})`);
      }
    }
  }

  if (config.user?.name) {
    parts.push(`speaking with ${config.user.name}`);
  }

  return parts.join(" ");
}

/**
 * Build a contextual greeting based on configuration
 */
export function buildGreeting(config: CombinedSoulConfig): string {
  if (!config.user) {
    return "Hello!";
  }

  const greeting = getTimeBasedGreeting(config.user);

  if (config.identity?.emoji) {
    return `${config.identity.emoji} ${greeting}!`;
  }

  return `${greeting}!`;
}

/**
 * Extract key traits for quick reference
 */
export function extractKeyTraits(config: CombinedSoulConfig): {
  identity: string;
  personality: string[];
  boundaries: string[];
} {
  const identity = config.identity
    ? `${config.identity.name}${config.identity.creature ? ` the ${config.identity.creature}` : ""}`
    : "Agent";

  const personality: string[] = [];
  if (config.identity?.vibe) {
    personality.push(...config.identity.vibe.split(",").map((s: string) => s.trim()));
  }
  if (config.soul?.vibe) {
    personality.push(config.soul.vibe);
  }

  const boundaries = config.soul?.boundaries || [];

  return { identity, personality, boundaries };
}
