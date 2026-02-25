// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * TUI Theme Configuration
 *
 * Defines colors and styling for all TUI components.
 */

import chalk from "chalk";
import type { EditorTheme, MarkdownTheme, SelectListTheme } from "@mariozechner/pi-tui";

// Color palette
export const colors = {
  // Primary colors
  primary: chalk.cyan,
  secondary: chalk.gray,
  accent: chalk.yellow,

  // Status colors
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,

  // Message roles
  user: chalk.blue,
  assistant: chalk.green,
  system: chalk.gray,
  tool: chalk.magenta,

  // UI elements
  border: chalk.gray,
  muted: chalk.dim,
  highlight: chalk.inverse,
};

// Select list theme
export const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => chalk.cyan(text),
  selectedText: (text) => chalk.cyan.bold(text),
  description: (text) => chalk.gray(text),
  scrollInfo: (text) => chalk.dim(text),
  noMatch: (text) => chalk.yellow(text),
};

// Editor theme
export const editorTheme: EditorTheme = {
  borderColor: (text) => chalk.gray(text),
  selectList: selectListTheme,
};

// Markdown theme
export const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.bold.cyan(text),
  link: (text) => chalk.blue.underline(text),
  linkUrl: (text) => chalk.dim(text),
  code: (text) => chalk.bgGray.white(text),
  codeBlock: (text) => chalk.white(text),
  codeBlockBorder: (text) => chalk.gray(text),
  quote: (text) => chalk.italic.gray(text),
  quoteBorder: (text) => chalk.gray(text),
  hr: (text) => chalk.gray(text),
  listBullet: (text) => chalk.cyan(text),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
};

// Status line colors
export const statusColors = {
  mode: {
    default: chalk.bgCyan.black,
    fast: chalk.bgYellow.black,
  },
  model: chalk.gray,
  thread: chalk.dim,
  om: {
    idle: chalk.dim,
    observing: chalk.yellow,
    reflecting: chalk.magenta,
  },
  running: chalk.green,
  waiting: chalk.gray,
};

// Tool approval colors
export const toolApprovalColors = {
  toolName: chalk.magenta.bold,
  category: chalk.gray,
  args: chalk.dim,
  approve: chalk.green,
  decline: chalk.red,
  alwaysAllow: chalk.cyan,
};
