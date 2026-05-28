# Security Policy

## Supported Status

`exa-cli` is experimental and solo-maintained. Security reports are reviewed on a best-effort basis, without a formal response SLA.

| Version or branch | Supported |
| --- | --- |
| `main` | Yes |
| Published npm package | Yes, once published |
| Unsupported forks or modified releases | No |

## Reporting A Vulnerability

Do not open a public issue for suspected vulnerabilities.

Report privately through GitHub's private vulnerability reporting for this repository once it is enabled, or contact the maintainer directly if that path is not available.

Include:

- affected version, package, commit, or release artifact
- reproduction steps
- expected impact
- relevant logs, proof of concept, or package metadata
- whether the issue appears exploitable in default configuration

Please redact API keys, personal data, private endpoints, provider responses, and unrelated secrets from reports.

## Scope

In scope:

- CLI payload decoding and output envelopes
- Exa API request construction and response handling
- artifact file writing and local runtime data handling
- package installation paths and generated release assets

Out of scope:

- unsupported versions or forks
- social engineering
- denial-of-service against maintainer-owned infrastructure
- Exa service behavior outside this CLI's request and response handling
- user-provided payloads that intentionally exfiltrate or publish private data
- findings that require already-compromised local machines unless this project increases impact

## Disclosure

The maintainer will coordinate disclosure timing based on severity, available fixes, and user impact. No response-time SLA is promised.

## Supply Chain Notes

Official release channels are not live yet. The intended first public channel is npm:

- `@skastr0/exa-cli`

Do not trust binaries, packages, or install commands from channels not listed here or in `README.md`.
