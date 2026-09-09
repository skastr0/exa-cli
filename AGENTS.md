# @skastr0/exa-cli - Agent Guide

## Project Intent

This is a JSON-first Effect CLI for Exa provider operations. It replaces the old
OpenCode-local `exa-tools` provider wrapper with a generic command-line surface
that can be used directly or wrapped by thin harness plugins later.

## Interface Rules

- Every provider operation accepts one JSON object argument.
- Inputs may be inline JSON, `@file`, `-`, or `@-`.
- Stdout is always a deterministic success envelope.
- Stderr is always a deterministic failure envelope for recoverable errors.
- Do not write free-form operational output to stdout.

## Stack

- Runtime: Bun
- CLI: `@effect/cli`
- Effects and schemas: `effect`
- HTTP: `@effect/platform` and `@effect/platform-bun`
- Tests: Vitest with `@effect/vitest`

## Commands

- `auth status`
- `doctor`
- `capabilities`
- `schema list`
- `schema show <command>`
- `examples list`
- `examples show <command-or-example-name>`
- `web-search`
- `code-context`
- `contents`
- `crawl`
- `answer`
- `company-research`
- `linkedin-search`
- `find-similar`
- `agent start|run|check|inspect|list|wait|events|stream|cancel|stop|delete`
- `deep-research start|run|check|inspect|list|wait|events|stream|cancel`

## Environment

- `EXA_API_KEY`
- `EXA_API_BASE_URL`, defaulting to `https://api.exa.ai`

## Development

Use Bun for package operations:

```bash
bun install
bun run typecheck
bun run test
bun run build
```

Keep old OpenCode plugin compatibility outside this package. This project should
remain a generic Exa CLI, not an OpenCode plugin.
