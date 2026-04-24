# @skastr0/exa-cli

A JSON-first Effect CLI for Exa provider operations.

## Commands

Every operation accepts one JSON input argument. Inputs can be inline JSON, `@file`,
or `-` for stdin. Every command returns a deterministic JSON envelope:

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
- `web-search`
- `code-context`
- `crawl`
- `company-research`
- `linkedin-search`
- `deep-research start`
- `deep-research check`
- `find-similar`

## Examples

```bash
bun run dev web-search '{"query":"Effect Schema","numResults":5}'
bun run dev code-context '{"query":"React useState examples","tokensNum":5000}'
bun run dev crawl '{"url":"https://example.com","maxCharacters":3000}'
bun run dev deep-research start '{"instructions":"Research the Exa API"}'
```

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXA_API_KEY` | Yes | - | Exa API key |
| `EXA_API_BASE_URL` | No | `https://api.exa.ai` | Exa API base URL |

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
```

The build script emits static binaries named `exa-cli-<platform>-<arch>` into `dist/`.
