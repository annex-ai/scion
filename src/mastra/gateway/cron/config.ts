// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Cron Configuration
 *
 * Loads cron settings from agent.toml [cron] section.
 */

import { type CronSection, getCronConfig } from "../../lib/config";

export { getCronConfig, type CronSection };
