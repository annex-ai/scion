# Cron Service Test

> Tests the SchedulerService's ability to execute agent-defined CRON schedules
> from CRON.md

## Prerequisites

- GatewayServer running with SchedulerService enabled
- CRON.md file exists at `.agent/CRON.md`
- At least one channel (Slack or Telegram) configured and connected

## Test Setup

```bash
# Ensure clean state
rm -f .agent/CRON.md
touch .agent/CRON.md
```

## Test Scenario: Agent Creates Self-Reminder

### Step 1: Agent Creates CRON Schedule

**Agent Action:** Create a daily reminder schedule

```markdown
<!-- Agent appends to CRON.md -->
## Test Daily Reminder

- **Schedule**: `* * * * *` (every minute for testing)
- **Message**: "⏰ Test reminder: This is your scheduled reminder from the Cron Service test!"
- **Target**: slack (or configured channel)
```

**Expected CRON.md content:**
```markdown
## Test Daily Reminder

- **Schedule**: `* * * * *`
- **Message**: "⏰ Test reminder: This is your scheduled reminder from the Cron Service test!"
- **Target**: slack
```

### Step 2: Wait for Scheduler Detection

**System Action:** SchedulerService hot-reloads CRON.md (30s polling interval)

**Expected Log Output:**
```
[scheduler] Created job: Test Daily Reminder (cron: * * * * *, next: 2024-01-15T10:30:00Z)
```

### Step 3: Verify Schedule Execution

**Wait:** 60-90 seconds (for cron to trigger)

**Expected Outcomes:**

1. **Message delivered to channel:**
   ```
   ⏰ Test reminder: This is your scheduled reminder from the Cron Service test!
   ```

2. **Agent receives message as inbound:**
   - Channel type: `scheduler`
   - Sender: `Schedule: Test Daily Reminder`
   - Is mention: `true`

3. **Agent responds to reminder**

### Step 4: Agent Updates Schedule

**Agent Action:** Modify the schedule to run less frequently

```markdown
<!-- Agent updates CRON.md -->
## Test Daily Reminder

- **Schedule**: `0 9 * * *` (daily at 9 AM)
- **Message**: "⏰ Daily standup reminder"
- **Target**: slack
```

**Expected:** Scheduler hot-reloads and updates the job

### Step 5: Agent Removes Schedule

**Agent Action:** Delete the test schedule from CRON.md

**Expected:** Scheduler removes the job

```
[scheduler] Removed job: Test Daily Reminder
```

## Test Scenario: Concurrent Execution Protection

### Step 1: Create Slow Schedule

**Agent Action:** Create a schedule with long-running task

```markdown
## Test Protected Job

- **Schedule**: `* * * * *` (every minute)
- **Message**: "Starting long-running analysis..."
- **Target**: slack
- **Protect**: true
```

### Step 2: Simulate Slow Execution

**Action:** Agent takes 90 seconds to respond

**Expected:** Second execution is skipped because first is still running

```
[scheduler] Job 'Test Protected Job' still running, skipping this execution
```

### Step 3: Verify Without Protect

**Action:** Set `Protect: false` (or omit)

**Expected:** Multiple executions overlap (not recommended for most tasks)

## Test Scenario: Max Concurrent Schedules

### Step 1: Create Many Schedules

**Action:** Create 15+ schedules

**Expected:** All schedules run (no hard limit enforced at service level)

**Note:** Practical limits depend on system resources and execution time.

## Success Criteria

| Check | Expected | Actual |
|-------|----------|--------|
| Schedule created | CRON.md updated | ⬜ |
| Job detected | Scheduler log shows creation | ⬜ |
| Message delivered | Channel receives message | ⬜ |
| Agent receives | Inbound message processed | ⬜ |
| Schedule updated | Hot-reload works | ⬜ |
| Schedule removed | Job stopped | ⬜ |
| Protect works | Concurrent execution prevented | ⬜ |

## Cleanup

```bash
# Remove test schedule from CRON.md
# (Agent should do this automatically)
```

## Failure Modes

| Issue | Diagnostic |
|-------|------------|
| No message received | Check scheduler logs, verify CRON.md syntax |
| Wrong channel | Verify target matches connected channel |
| Delayed delivery | Check poll_interval (default 30s) |
| Duplicate messages | Ensure protect: true prevents overlap |
| Concurrent execution | Check protect flag is set |

## Related Components

- `src/mastra/gateway/scheduler/service.ts` - Scheduler implementation
- `src/mastra/gateway/scheduler/executor.ts` - Job execution
- `src/mastra/gateway/loaders/cron-md-loader.ts` - CRON.md parsing
