# Process Management Documentation

Complete guide to the bash tool's PTY/background execution modes and the process tool for managing long-running sessions.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Bash Tool](#bash-tool)
  - [Standard Mode](#standard-mode)
  - [PTY Mode](#pty-mode)
  - [Background Mode](#background-mode)
  - [PTY + Background](#pty--background)
- [Process Tool](#process-tool)
  - [list](#list)
  - [poll](#poll)
  - [log](#log)
  - [write](#write)
  - [paste](#paste)
  - [submit](#submit)
  - [send-keys](#send-keys)
  - [kill](#kill)
- [Key Token Reference](#key-token-reference)
- [Process Registry](#process-registry)
- [Usage Examples](#usage-examples)
- [File Structure](#file-structure)

---

## Overview

The shell execution system provides four modes of operation:

| Mode | Params | Use Case |
|------|--------|----------|
| **Standard** | (default) | Run a command, wait for output |
| **PTY sync** | `pty: true` | Run with pseudo-terminal (colors, interactive), wait for output |
| **Background** | `background: true` | Spawn and return immediately, poll later |
| **PTY + Background** | `pty: true, background: true` | Interactive background session with full terminal emulation |

```
┌─────────────────────────────────────────────────────────────┐
│                    Bash Tool                                 │
│                                                             │
│  bash({ command, timeout?, cwd?, workdir?, pty?, background? })
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐  │
│  │ Standard │  │ PTY Sync │  │ Background (± PTY)       │  │
│  │ (pipe)   │  │ (node-pty│  │ spawn → registry → poll  │  │
│  │          │  │  sync)   │  │                          │  │
│  └────┬─────┘  └────┬─────┘  └────────────┬─────────────┘  │
│       │              │                     │                 │
│       ▼              ▼                     ▼                 │
│  { stdout,      { stdout,            { sessionId,           │
│    stderr,        stderr: '',          pid,                  │
│    exit_code }    exit_code }          exit_code: null }     │
│                                            │                 │
└────────────────────────────────────────────┼─────────────────┘
                                             │
                                    ┌────────▼────────┐
                                    │  Process Tool   │
                                    │  (8 actions)    │
                                    │                 │
                                    │  list · poll    │
                                    │  log · write    │
                                    │  paste · submit │
                                    │  send-keys      │
                                    │  kill           │
                                    └─────────────────┘
```

---

## Architecture

### Process Registry

All background processes are tracked in an in-memory registry (`process-registry.ts`). Each entry holds:

- OS process handle (PTY or ChildProcess)
- Output buffer (1 MB max per process, FIFO trimming)
- Status (running/exited), exit code, exit signal
- Character-based poll cursor for incremental output reads

**Limits:**
- Max 50 concurrent processes (oldest exited process evicted on overflow)
- Output buffer: 1 MB per process (head-trimmed using byte-accurate UTF-8 calculation)
- Exited processes auto-pruned after 30 minutes
- All processes killed on server shutdown

### node-pty

PTY support uses Microsoft's [node-pty](https://github.com/microsoft/node-pty) library, loaded lazily on first PTY request. This provides:

- Full terminal emulation (xterm-256color, 120x40)
- Color/ANSI escape support
- Interactive program support (editors, REPLs, TUI apps)
- Bracketed paste mode for distinguishing pasted vs typed text

---

## Bash Tool

Tool ID: `bash`

### Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | Yes | Bash command to execute |
| `timeout` | number | No | Timeout in seconds (standard and PTY sync modes only) |
| `cwd` | string | No | Working directory (defaults to `process.cwd()`) |
| `workdir` | string | No | Alias for `cwd` |
| `pty` | boolean | No | Allocate a pseudo-terminal |
| `background` | boolean | No | Run in background, return sessionId immediately |

### Output Schema

| Field | Type | Description |
|-------|------|-------------|
| `stdout` | string | Standard output (or status message for background) |
| `stderr` | string | Standard error (empty string for PTY mode, which merges streams) |
| `exit_code` | number \| null | Exit code (`null` for background or killed processes) |
| `truncated` | boolean | Whether output was truncated |
| `full_output_file` | string? | Path to temp file with full output (only when truncated) |
| `sessionId` | string? | Process registry ID (background mode only) |
| `pid` | number? | OS process ID (background mode only) |

### Standard Mode

Default behavior — runs a command, waits for completion, returns output.

```json
{ "command": "ls -la /tmp" }
```

Returns:
```json
{
  "stdout": "total 48\ndrwxrwxrwt ...",
  "stderr": "",
  "exit_code": 0,
  "truncated": false
}
```

Features:
- Separate stdout/stderr streams
- Output truncation (last 100K lines or 10 MB)
- Timeout support (kills process tree on timeout)
- Abort signal support
- Full output saved to temp file when truncated

### PTY Mode

Allocates a pseudo-terminal for the command. Use for programs that need terminal features.

```json
{ "command": "ls --color=auto", "pty": true }
```

Returns:
```json
{
  "stdout": "\u001b[0m\u001b[01;34mbin\u001b[0m  ...",
  "stderr": "",
  "exit_code": 0,
  "truncated": false
}
```

Key differences from standard mode:
- stdout/stderr are merged into a single stream (`stderr` is always `""`)
- ANSI color codes are preserved
- Terminal dimensions: 120 columns x 40 rows
- Terminal type: `xterm-256color`

### Background Mode

Spawns a process and returns immediately with a `sessionId` for later management.

```json
{ "command": "npm run build", "background": true }
```

Returns:
```json
{
  "stdout": "Background process started [a1b2c3d4] (pid: 12345)",
  "stderr": "",
  "exit_code": null,
  "truncated": false,
  "sessionId": "a1b2c3d4",
  "pid": 12345
}
```

Key behaviors:
- Non-PTY background: separate stdout/stderr (stderr lines prefixed with `[stderr]`)
- Process group leader (`detached: true`) for clean subprocess cleanup
- File descriptors unref'd so the event loop doesn't block
- Use the **process tool** to interact with the session

### PTY + Background

Combines pseudo-terminal with background execution — ideal for interactive sessions (REPLs, editors, TUI apps).

```json
{ "command": "python3", "pty": true, "background": true }
```

Returns:
```json
{
  "stdout": "Background PTY process started [a1b2c3d4] (pid: 12345)",
  "stderr": "",
  "exit_code": null,
  "truncated": false,
  "sessionId": "a1b2c3d4",
  "pid": 12345
}
```

---

## Process Tool

Tool ID: `process`

Manages background processes spawned by the bash tool. All actions except `list` require a `sessionId`.

### Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | One of: `list`, `poll`, `log`, `write`, `paste`, `submit`, `send-keys`, `kill` |
| `sessionId` | string | For all except `list` | Session ID from bash background output |
| `offset` | number | No | Line offset for `log` action |
| `limit` | number | No | Max lines for `log` action |
| `data` | string | For `write`/`paste`/`submit` | Data to send to stdin |
| `keys` | string[] | For `send-keys` | Key tokens to send (see [Key Token Reference](#key-token-reference)) |
| `signal` | string | No | Signal for `kill` action (default: `SIGTERM`) |

### list

Show all tracked processes with their status and runtime.

```json
{ "action": "list" }
```

Returns:
```json
{
  "success": true,
  "message": "3 process(es)",
  "processes": [
    {
      "id": "a1b2c3d4",
      "command": "npm run build",
      "cwd": "/home/user/project",
      "pid": 12345,
      "status": "running",
      "isPty": false,
      "runtimeMs": 5230,
      "exitCode": null
    }
  ]
}
```

Notes:
- `runtimeMs` is bounded for exited processes (stops growing after exit)
- Expired processes (30+ min after exit) are auto-pruned on list
- Commands longer than 80 chars are truncated in display

### poll

Check status and get new output since the last poll. Uses a character-based cursor that advances on each poll call.

```json
{ "action": "poll", "sessionId": "a1b2c3d4" }
```

Returns:
```json
{
  "success": true,
  "status": "running",
  "exitCode": null,
  "exitSignal": null,
  "output": "Building module 3/10...\n",
  "outputOffset": 1024,
  "outputLines": 2,
  "totalBytesReceived": 2048,
  "bytesDiscarded": 0
}
```

Notes:
- Only returns output **since the last poll** (incremental)
- Capped at ~24K chars per poll to prevent overwhelming responses
- First poll returns all buffered output
- `bytesDiscarded > 0` indicates the head of the buffer was trimmed (output exceeded 1 MB)

### log

Read output with line-based offset/limit pagination. Unlike `poll`, does not advance the cursor.

```json
{ "action": "log", "sessionId": "a1b2c3d4", "offset": 0, "limit": 50 }
```

Returns:
```json
{
  "success": true,
  "output": "line 1\nline 2\n...",
  "outputOffset": 0,
  "outputLines": 50,
  "totalBytesReceived": 8192,
  "bytesDiscarded": 0,
  "hasGap": false
}
```

Notes:
- `hasGap: true` when `bytesDiscarded > 0` and reading from offset 0 (early output was lost)
- Without offset/limit, returns the entire buffer

### write

Send raw data to the process's stdin. No line ending is appended.

```json
{ "action": "write", "sessionId": "a1b2c3d4", "data": "some input" }
```

### paste

Send data with bracketed paste mode for PTY processes. Non-PTY processes receive raw data (same as write).

```json
{ "action": "paste", "sessionId": "a1b2c3d4", "data": "pasted code block" }
```

PTY processes receive: `\x1b[200~pasted code block\x1b[201~`

This allows TUI apps (vim, nano, etc.) to distinguish pasted text from typed input.

### submit

Send data with a line ending appended (`\r` for PTY, `\n` for non-PTY).

```json
{ "action": "submit", "sessionId": "a1b2c3d4", "data": "print('hello')" }
```

### send-keys

Send key tokens mapped to terminal escape sequences. For non-PTY processes, signal keys send OS signals instead of escape bytes.

```json
{ "action": "send-keys", "sessionId": "a1b2c3d4", "keys": ["C-c"] }
```

Returns:
```json
{
  "success": true,
  "message": "C-c → SIGINT (sent)"
}
```

For PTY processes, `C-c` writes `\x03`. For non-PTY processes, `C-c` sends `SIGINT` to the process group.

### kill

Send a signal to the process. If the process has already exited, removes it from the registry.

```json
{ "action": "kill", "sessionId": "a1b2c3d4" }
```

Valid signals: `SIGTERM` (default), `SIGKILL`, `SIGINT`, `SIGHUP`, `SIGQUIT`, `SIGTSTP`, `SIGCONT`

Notes:
- Non-PTY processes: signal sent to entire process group (`kill(-pid, signal)`) to prevent orphaned children
- Already-exited processes are removed from the registry on kill
- Invalid signal names return a descriptive error

---

## Key Token Reference

Available tokens for the `send-keys` action:

### Control Keys

| Token | Escape | Non-PTY Behavior |
|-------|--------|-----------------|
| `C-c` | `\x03` | Sends `SIGINT` |
| `C-d` | `\x04` | — |
| `C-z` | `\x1a` | Sends `SIGTSTP` |
| `C-l` | `\x0c` | — |
| `C-a` | `\x01` | — |
| `C-e` | `\x05` | — |
| `C-k` | `\x0b` | — |
| `C-u` | `\x15` | — |
| `C-w` | `\x17` | — |
| `C-r` | `\x12` | — |
| `C-\` | `\x1c` | Sends `SIGQUIT` |

### Navigation Keys

| Token | Escape |
|-------|--------|
| `Enter` | `\r` |
| `Tab` | `\t` |
| `Escape` | `\x1b` |
| `Backspace` | `\x7f` |
| `Up` | `\x1b[A` |
| `Down` | `\x1b[B` |
| `Right` | `\x1b[C` |
| `Left` | `\x1b[D` |
| `Home` | `\x1b[H` |
| `End` | `\x1b[F` |
| `PageUp` | `\x1b[5~` |
| `PageDown` | `\x1b[6~` |
| `Delete` | `\x1b[3~` |
| `Insert` | `\x1b[2~` |

### Function Keys

| Token | Escape |
|-------|--------|
| `F1`–`F4` | `\x1bOP`–`\x1bOS` |
| `F5`–`F12` | `\x1b[15~`–`\x1b[24~` |

---

## Process Registry

The registry (`src/mastra/tools/process-registry.ts`) is the shared in-memory store used by both the bash and process tools.

### ProcessEntry Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | 8-char hex identifier |
| `command` | string | Original command string |
| `cwd` | string | Working directory |
| `pid` | number | OS process ID |
| `status` | `'running'` \| `'exited'` | Current process state |
| `isPty` | boolean | Whether using pseudo-terminal |
| `startTime` | number | `Date.now()` at spawn |
| `exitTime` | number \| null | `Date.now()` at exit |
| `exitCode` | number \| null | Process exit code |
| `exitSignal` | string \| null | Signal that killed the process |
| `output` | string | Buffered output (max 1 MB) |
| `totalBytesReceived` | number | Lifetime bytes received |
| `bytesDiscarded` | number | Bytes trimmed from head |
| `lastPollOffset` | number | Character cursor for poll |

### Buffer Management

Output is stored as a single string with FIFO trimming:

1. New data appended via `appendOutput()`
2. If `Buffer.byteLength(output) > 1 MB`, head bytes are trimmed
3. `bytesDiscarded` tracks cumulative bytes lost
4. `lastPollOffset` adjusted on trim so poll cursor doesn't go stale
5. Multi-byte UTF-8 handled correctly via byte/char ratio estimation

### Shutdown Behavior

On `process.exit`, all running processes are killed:
- PTY processes: `pty.kill()`
- Non-PTY processes: `process.kill(-pid, 'SIGKILL')` (process group) + `child.kill('SIGKILL')` (fallback)

---

## Usage Examples

### Run a build in the background and monitor it

```
1. bash({ command: "npm run build", background: true })
   → { sessionId: "a1b2c3d4", pid: 12345 }

2. process({ action: "poll", sessionId: "a1b2c3d4" })
   → { status: "running", output: "Compiling..." }

3. process({ action: "poll", sessionId: "a1b2c3d4" })
   → { status: "exited", exitCode: 0, output: "Build complete." }

4. process({ action: "kill", sessionId: "a1b2c3d4" })
   → Removes from registry
```

### Interactive Python REPL

```
1. bash({ command: "python3", pty: true, background: true })
   → { sessionId: "e5f6g7h8", pid: 23456 }

2. process({ action: "submit", sessionId: "e5f6g7h8", data: "print(1+1)" })
   → { success: true }

3. process({ action: "poll", sessionId: "e5f6g7h8" })
   → { output: ">>> print(1+1)\r\n2\r\n>>> " }

4. process({ action: "send-keys", sessionId: "e5f6g7h8", keys: ["C-d"] })
   → Sends EOF, Python exits
```

### Paste code into an editor

```
1. bash({ command: "vim file.py", pty: true, background: true })
   → { sessionId: "i9j0k1l2" }

2. process({ action: "send-keys", sessionId: "i9j0k1l2", keys: ["i"] })
   → Enter insert mode

3. process({ action: "paste", sessionId: "i9j0k1l2", data: "def hello():\n    print('hi')" })
   → Bracketed paste so vim handles it correctly

4. process({ action: "send-keys", sessionId: "i9j0k1l2", keys: ["Escape"] })
   → Back to normal mode

5. process({ action: "submit", sessionId: "i9j0k1l2", data: ":wq" })
   → Save and quit
```

### Cancel a long-running process

```
1. bash({ command: "find / -name '*.log'", background: true })
   → { sessionId: "m3n4o5p6" }

2. process({ action: "kill", sessionId: "m3n4o5p6", signal: "SIGKILL" })
   → Kills process and all child subprocesses
```

### Check all running processes

```
1. process({ action: "list" })
   → { processes: [ { id: "a1b2c3d4", status: "running", runtimeMs: 5230, ... } ] }
```

---

## File Structure

```
src/mastra/tools/
├── bash.ts                 # Bash tool with PTY/background support
├── process.ts              # Process management tool (8 actions)
├── process-registry.ts     # In-memory process registry
├── core-tools.ts           # Tool registration (includes both tools)
├── index.ts                # Re-exports
└── __tests__/
    └── bash-pty.test.ts    # 24 tests covering all modes and edge cases
```
