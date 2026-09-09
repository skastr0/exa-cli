# Changelog

All notable changes to this project will be documented here.

## [Unreleased]

## [0.2.0] - 2026-09-09

### Added

- `contents` command for `POST /contents` with `ids` or `urls`, text/highlights/summary/extras, subpages, and `maxAgeHours`.
- `answer` command for grounded `POST /answer` responses, including structured `outputSchema`.
- `agent` lifecycle commands over `POST/GET/DELETE /agent/runs`, including cancel, stop, delete, events, and SSE collection.
- Web search contents options, `outputSchema`, `systemPrompt`, `additionalQueries`, `userLocation`, `moderation`, `deep-lite`, and `deep-reasoning`.
- `deep-research cancel`, now that Agent runs document a cancel endpoint.

### Changed

- Default web-search type is `auto`. Search types match the current public API: `auto`, `fast`, `instant`, `deep-lite`, `deep`, `deep-reasoning`.
- `publication` replaces `research paper` as the scholarly category. `pdf`, `github`, and `tweet` remain accepted as deprecated hints.
- `crawl` sends top-level `/contents` fields and `maxAgeHours: 0` instead of nested `contents.livecrawl`.
- `company-research` uses `category: "company"`; `linkedin-search` profiles/companies use `people`/`company`.
- `deep-research *` aliases Agent runs so the old async lifecycle still works. Exa replaced `/research` with `POST /search` `type: "deep-reasoning"`; that search type stays on `web-search` and is not the same product as Agent.
- Search phrase filters (`includeText` / `excludeText`) are limited to one string of at most five words. Entity categories and `financial report` reject unsupported filters before they 400.
- Agent `budget` is accepted only with `effort` `auto` or `max`. `dataSources` is capped at 5 providers.

### Removed

- The `neural` search type is rejected with a typed error. The retired `/research/v1` `model` field is rejected with a typed error.

## [0.1.0] - 2026-06-03

### Added

- Initial experimental JSON-first Exa provider CLI.
- Public repository files and package metadata for the first experimental npm release.
- Reworked npm CLI distribution around a Node launcher plus per-platform Bun standalone binary packages.

### Security

- Added transitive dependency overrides for patched `uuid` and `ws` releases.
