# @skastr0/exa-cli

`exa-cli` is an experimental JSON-first Effect CLI for Exa provider operations.

## Status

- Maturity: experimental
- Maintainer model: solo-maintained
- Repository visibility: private until explicitly approved for public access
- Package channel: npm is the intended first channel, but the package is not published yet

Use this project when an agent or script needs a stable command-line contract for Exa search, crawl, company research, LinkedIn search, code context, and deep research workflows. Do not use it as a credential store, scraping proxy, hosted research worker, or replacement for Exa's service terms and account controls.

## Package

The intended npm package is `@skastr0/exa-cli`. The package exposes the `exa-cli` binary and ships the TypeScript source for Bun execution.

Until packages are published, install from source:

```bash
bun install
bun run build
bun run install:local
```

Requirements:

- Bun 1.3 or newer
- an Exa API key for provider-backed commands

## Protocol

Every operation accepts one JSON input argument. Inputs can be inline JSON, `@file`, `-`, or `@-` for stdin. Prefer `@file` payloads in scripts so payloads stay reviewable and repeatable.

Every command returns a deterministic JSON envelope:

```json
{
  "ok": true,
  "command": "web-search",
  "data": {}
}
```

Failures are emitted to stderr as:

```json
{
  "ok": false,
  "command": "web-search",
  "error": {
    "type": "JsonInputError",
    "message": "...",
    "details": {}
  }
}
```

Available commands:

- `auth status`
- `doctor`
- `capabilities`
- `schema list`
- `schema show <command>`
- `examples list`
- `examples show <command-or-example-name>`
- `web-search`
- `code-context`
- `crawl`
- `company-research`
- `linkedin-search`
- `deep-research start`
- `deep-research run`
- `deep-research check`
- `deep-research inspect`
- `deep-research list`
- `deep-research wait`
- `deep-research events`
- `deep-research stream`
- `find-similar`

## Batch Commands

The fan-out commands accept either one object or an array of objects:

- `web-search`
- `code-context`
- `crawl`
- `company-research`
- `linkedin-search`
- `find-similar`

Batch output preserves input order and includes `outcome`, counts, `concurrency`, per-item `target`, and per-item success/error records. If any item fails, the command exits with code `1` while still writing the itemized batch envelope to stdout.

Use `--concurrency <n>` to control bounded parallelism.

## Large Output

Search, crawl, and research commands support:

```bash
--output inline
--output artifact
--output auto
```

`artifact` always writes the command result JSON to disk and returns a compact summary plus an artifact record. `auto` writes an artifact when the result is large. By default, CLI-owned artifacts are written under `~/.config/exa-cli/artifacts`, never under the current project directory.

Set `EXA_CLI_HOME` to relocate all CLI-local runtime data. Set `EXA_CLI_ARTIFACT_DIR` only when you explicitly want artifacts in a specific directory, including a project directory.

## Deep Research

Deep research uses Exa's asynchronous research API:

- `deep-research start @payload.json`
- `deep-research run @payload.json`
- `deep-research check @payload.json`
- `deep-research inspect @payload.json`
- `deep-research list @payload.json`
- `deep-research wait @payload.json`
- `deep-research events @payload.json`
- `deep-research stream @payload.json`

`run` is an alias for `start`; `inspect` is an alias for `check`. `wait` polls until `completed`, `canceled`, or `failed`. `events` fetches the provider event log, and `stream` collects provider SSE events into a JSON envelope.

The provider does not document a research-task cancel endpoint. `capabilities` reports cancel as unsupported.

## Discovery

Agents can discover the contract without scraping this README:

```bash
bun run dev doctor
bun run dev capabilities
bun run dev schema list
bun run dev schema show web-search
bun run dev examples list
bun run dev examples show batch-search
```

## Examples

Create payload files:

```bash
mkdir -p payloads

cat > payloads/web-search.json <<'JSON'
{"query":"Effect Schema","numResults":5}
JSON

cat > payloads/web-search-batch.json <<'JSON'
[
  {"query":"Effect Schema"},
  {"query":"Effect CLI"}
]
JSON

cat > payloads/crawl.json <<'JSON'
{"url":"https://example.com","maxCharacters":3000}
JSON

cat > payloads/deep-research-start.json <<'JSON'
{"instructions":"Research the Exa API"}
JSON

cat > payloads/deep-research-wait.json <<'JSON'
{"researchId":"01jszdfs0052sg4jc552sg4jc5","intervalMs":2000,"timeoutMs":180000}
JSON
```

Run commands:

```bash
bun run dev web-search @payloads/web-search.json
bun run dev web-search --concurrency 2 @payloads/web-search-batch.json
bun run dev crawl --output artifact @payloads/crawl.json
bun run dev deep-research start @payloads/deep-research-start.json
bun run dev deep-research wait @payloads/deep-research-wait.json
```

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXA_API_KEY` | Yes | - | Exa API key |
| `EXA_API_BASE_URL` | No | `https://api.exa.ai` | Exa API base URL |
| `EXA_CLI_HOME` | No | `~/.config/exa-cli` | CLI-local runtime data root |
| `EXA_CLI_ARTIFACT_DIR` | No | `$EXA_CLI_HOME/artifacts` | Explicit artifact output directory |

Never commit credentials, `.env` files, payloads containing private data, provider responses containing private context, or generated scan output.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run pack:dry-run
```

The full local verification command is:

```bash
bun run verify
```

The build script emits static binaries named `exa-cli-<platform>-<arch>` into `dist/`.

## CI

GitHub Actions runs on pushes to `main` and on pull requests. The workflow installs with Bun, runs `bun run verify`, and inspects npm package contents with `bun run pack:dry-run`. Workflow permissions are read-only.

## Security

This CLI sends user-provided payloads to Exa using the configured API key. Review payloads before running them, keep API keys in your local environment, and redact provider responses before sharing logs.

Please report security issues privately. See `SECURITY.md`.

## Contributing And Support

Issues are welcome when they include enough context to reproduce or evaluate the request. See `CONTRIBUTING.md` and `SUPPORT.md` for project boundaries.

## License

MIT. See `LICENSE`.
