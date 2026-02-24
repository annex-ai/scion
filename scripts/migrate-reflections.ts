#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Migration script: Convert legacy REFLECTIONS.md to adaptation system format.
 *
 * Usage: bun scripts/migrate-reflections.ts
 */

import { runMigration } from "../src/mastra/lib/adaptation-migration";

await runMigration();
