# Issues & Backlog

## Gateway

### Consolidate timeout configuration
The gateway has multiple hardcoded timeouts for LLM responses scattered across files:
- `adapter.ts:173` — fetch AbortController timeout (currently 600s)
- `harness-routes.ts:261` — polling loop timeout (currently 600s)
- `server.ts:114` — per-channel connect timeout (2 min)

These should be configurable from a single source (e.g. `agent.toml [server]` or `[gateway]` section) rather than hardcoded in each file.

### Thread reset (`/new`) behavior with resource memory
When memory scope is "resource", `/new` deletes the shared resource thread. This may not be the desired behavior — it could erase the entire conversation history across all channels. Needs review of what "reset" means in resource-scoped memory mode.
