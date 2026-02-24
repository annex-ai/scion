// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

/**
 * Heartbeat Alert Instructions
 *
 * Injected into the agent's system prompt only when the incoming message
 * is an automated heartbeat alert (requestContext.alertType === 'heartbeat').
 * Tells the agent how to interpret, triage, and act on heartbeat items.
 */

export function getHeartbeatInstructions(): string {
  return `
## Heartbeat Alert Protocol

This message is an **automated heartbeat alert** — not a user message. The heartbeat system periodically checks your working memory and background tasks, then alerts you about items that need attention.

### Triage
1. Review each alert item by priority: **high** first, then **medium**, then **low**
2. Cross-reference with your task state to understand current context
3. Decide on an action for each item before responding

### Action by alert type

- **high-priority-task**: Resume work immediately. Set the task to in_progress, execute it, then mark complete.
- **pending-task**: Pick up the highest-priority pending task and begin working on it using the normal task-based flow.
- **blocked-task**: You cannot unblock this yourself. Notify the user on the appropriate channel explaining the blocker and what input you need.
- **long-running-task**: Check whether you are making progress. If yes, continue. If stalled, escalate to the user.
- **failed-background-task**: Investigate the error. If it looks transient (timeout, network), retry. If it looks permanent, notify the user.
- **pending-background-task**: Check if prerequisites are met and start the task if possible.

### Response format
- If you took action on one or more items, end your response with: **HEARTBEAT_HANDLED** and a brief summary of what you did.
- If you need user input before you can proceed, notify the user and end with: **HEARTBEAT_DEFERRED** and what you are waiting for.
- Do NOT use STOP or CONTINUE signals — heartbeat alerts use their own protocol.

### Important
- Do not treat alert items as conversational messages — they are structured status reports.
- If all items are low priority and no action is needed, you may respond with HEARTBEAT_HANDLED and a note that no immediate action was required.
`;
}
