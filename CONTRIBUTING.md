# Contributing to Scion

Thank you for your interest in contributing to Scion! Every contribution matters, whether it is a bug fix, a new feature, documentation improvement, or a test. We appreciate the time and effort you invest in making this project better.

## Contributor License Agreement (CLA)

By submitting a pull request to this repository, you agree to the following terms:

> I hereby grant to the project maintainer and to recipients of software
> distributed by the project maintainer a perpetual, worldwide, non-exclusive,
> no-charge, royalty-free, irrevocable license to use, reproduce, modify,
> prepare derivative works of, publicly display, publicly perform, sublicense,
> and distribute my contributions and any derivative works thereof under any
> license, including (without limitation) the license under which the project
> is distributed at the time of contribution.
>
> I represent that I am legally entitled to grant the above license. If my
> employer has rights to intellectual property that I create, I represent that
> I have received permission to make contributions on behalf of that employer,
> or that my employer has waived such rights for my contributions to this
> project.
>
> I understand that this project and my contributions are public and that a
> record of the contribution (including all personal information I submit with
> it) is maintained indefinitely and may be redistributed consistent with this
> project or the open-source license(s) involved.

Opening a pull request constitutes acceptance of these terms. No separate signature is required.

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0 (or Node.js >= 22.13)
- Git
- At least one LLM API key for testing (see `.env.example`)

## Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/annex-ai/scion.git
   cd agent
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Set up your environment:

   ```bash
   cp .env.example .env
   # Add at least one LLM key (GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY)
   ```

4. Verify your setup:

   ```bash
   bun run typecheck   # Should complete with no errors
   bun test            # Should pass
   ```

5. Start the development server:

   ```bash
   bun run dev
   ```

## Project Structure

| Path | Purpose |
| --- | --- |
| `src/mastra/gateway/channels/` | Channel adapters (Slack, Discord, etc.) |
| `src/mastra/tools/` | Tool definitions and implementations |
| `src/mastra/workflows/` | Workflow definitions |
| `.agent/skills/` | Skill definitions |
| `tests/` | Test suites |
| `docs/` | Documentation |

## Running Tests

```bash
bun test
```

Run tests before submitting any pull request to make sure nothing is broken.

## Coding Standards

- **Language:** TypeScript in strict mode
- **Target:** ES2022
- **Filenames:** kebab-case (e.g., `my-channel-adapter.ts`)
- **Indentation:** 2 spaces
- **General:** Keep functions focused, add types explicitly, and avoid `any` where possible
- **Linter:** [Biome](https://biomejs.dev/) — configured in [`biome.json`](biome.json)

Run the linter locally before submitting:

```bash
bun run lint          # Check for issues
bun run lint:fix      # Auto-fix where possible
```

## Commit Message Format

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must use one of the following prefixes:

- `feat:` -- a new feature
- `fix:` -- a bug fix
- `docs:` -- documentation changes
- `refactor:` -- code restructuring without behavior changes
- `test:` -- adding or updating tests
- `chore:` -- maintenance tasks (dependency updates, CI config, etc.)

Examples:

```
feat: add Telegram channel adapter
fix: resolve race condition in message queue
docs: update setup instructions for Windows
```

## Pull Request Process

1. **Fork** the repository and clone your fork locally.
2. **Create a branch** from `main` with a descriptive name:

   ```bash
   git checkout -b feat/my-new-feature
   ```

3. **Implement your changes**, keeping commits atomic and well-scoped.
4. **Commit** using Conventional Commits format:

   ```bash
   git commit -m "feat: describe your change"
   ```

5. **Sign off** your commits with DCO (`git commit -s`). All commits must include a `Signed-off-by:` line — CI enforces this.
6. **Push** your branch and **open a pull request** against `main`. By opening a PR you accept the CLA above.
7. Ensure **CI passes** on your pull request. CI runs typecheck, tests, lint, and DCO verification.

## Pull Request Review

- PRs are typically reviewed within a few days.
- PRs are squash-merged into `main` to keep a clean history.
- Small, focused PRs are reviewed faster than large ones — split if possible.
- If changes are requested, push new commits to the same branch (don't force-push).

## Adding a New Channel Adapter

Channel adapters live in `src/mastra/gateway/channels/`. Each adapter must implement the `ChannelAdapter` interface defined in:

```
src/mastra/gateway/channels/types.ts
```

Steps:

1. Create a new directory under `src/mastra/gateway/channels/` named after your channel (e.g., `telegram/`).
2. Implement the `ChannelAdapter` interface from `types.ts`.
3. Export your adapter and register it in the channel gateway.
4. Add tests under `tests/` covering connection, message sending, and message receiving.

## Adding a New Skill

Skill definitions live in `.agent/skills/`. Refer to the specification document for the full schema and examples:

```
docs/SKILL_SPEC.md
```

Follow the patterns established by existing skills in the `.agent/skills/` directory.

## Adding a New Tool

Tools live in `src/mastra/tools/`. To add a new tool:

1. Create a new file in `src/mastra/tools/` following kebab-case naming (e.g., `my-tool.ts`).
2. Implement your tool with typed inputs and outputs.
3. Register it in `src/mastra/tools/index.ts` so it becomes available to agents and workflows.
4. Add corresponding tests under `tests/`.
