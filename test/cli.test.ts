import { FileSystem } from "@effect/platform"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import {
  ApiDecodeError,
  ApiRequestError,
  ApiResponseError,
  CommandInputError,
  ConfigurationError,
  JsonInputError,
  MissingApiKeyError,
} from "../src/core/errors"
import { loadBatchJsonInput, loadJsonInput } from "../src/core/json"
import { toErrorDetails } from "../src/core/output"
import { expectJson, runCli } from "./helpers/cli"

interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly headers: IncomingMessage["headers"]
  readonly body: unknown
}

interface TestServer {
  readonly baseUrl: string
  readonly requests: ReadonlyArray<RecordedRequest>
  readonly close: Effect.Effect<void>
}

const readRequestBody = (request: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    let text = ""
    request.on("data", (chunk) => {
      text += chunk
    })
    request.on("end", () => {
      if (text.trim().length === 0) {
        resolve(undefined)
        return
      }

      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })

const writeJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

const withTestServer = <A>(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    record: (body: unknown) => void,
  ) => Promise<void>,
  use: (server: TestServer) => Effect.Effect<A>,
) =>
  Effect.acquireUseRelease(
    Effect.async<TestServer>((resume) => {
      const requests: RecordedRequest[] = []
      const server = createServer((request, response) => {
        const record = (body: unknown) => {
          requests.push({
            method: request.method ?? "",
            path: request.url ?? "",
            headers: request.headers,
            body,
          })
        }

        handler(request, response, record).catch((error: unknown) => {
          response.writeHead(500, { "content-type": "application/json" })
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        })
      })

      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (!address || typeof address === "string") {
          resume(Effect.die(new Error("failed to bind test server")))
          return
        }

        resume(
          Effect.succeed({
            baseUrl: `http://127.0.0.1:${address.port}`,
            requests,
            close: Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
          }),
        )
      })
    }),
    use,
    (server) => server.close,
  )

const withTempDir = <A>(use: (path: string) => Effect.Effect<A>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "exa-cli-test-"))),
    use,
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  )

describe("exa CLI", () => {
  it.effect("auth status reports missing API key without failing", () =>
    Effect.gen(function* () {
      const result = yield* runCli(["auth", "status"], {
        EXA_API_KEY: undefined,
        EXA_API_BASE_URL: undefined,
      })

      const payload = expectJson<{
        ok: boolean
        command: string
        data: { configured: boolean; authenticated: boolean; api_base_url: string }
      }>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("auth status")
      expect(payload.data.configured).toBe(false)
      expect(payload.data.authenticated).toBe(false)
      expect(payload.data.api_base_url).toBe("https://api.exa.ai")
    }),
  )

  it.effect("doctor reports default CLI runtime data outside the project tree", () =>
    Effect.gen(function* () {
      const result = yield* runCli(["doctor"], {
        EXA_API_KEY: undefined,
        EXA_API_BASE_URL: undefined,
        EXA_CLI_HOME: undefined,
        EXA_CLI_ARTIFACT_DIR: undefined,
      })

      const payload = expectJson<{
        ok: boolean
        data: {
          environment: {
            cli_home: string
            artifact_dir: string
          }
          capabilities: {
            runtime_data: {
              default_home: string
              cwd_default: boolean
              project_output_requires_explicit_path: boolean
            }
          }
        }
      }>(result.stdout)

      const expectedHome = join(homedir(), ".config", "exa-cli")

      expect(result.exitCode).toBe(0)
      expect(payload.ok).toBe(true)
      expect(payload.data.environment.cli_home).toBe(expectedHome)
      expect(payload.data.environment.artifact_dir).toBe(join(expectedHome, "artifacts"))
      expect(payload.data.capabilities.runtime_data.default_home).toBe("~/.config/exa-cli")
      expect(payload.data.capabilities.runtime_data.cwd_default).toBe(false)
      expect(payload.data.capabilities.runtime_data.project_output_requires_explicit_path).toBe(true)
    }),
  )

  it.effect("web-search accepts JSON input and sends the Exa search request", () =>
    withTestServer(
      async (request, response, record) => {
        const body = await readRequestBody(request)
        record(body)
        writeJson(response, 200, {
          requestId: "req_1",
          resolvedSearchType: "instant",
          context: "search context",
          results: [{ id: "1", title: "Result", url: "https://example.com" }],
        })
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            [
              "web-search",
              '{"query":"Effect Schema","includeText":"Effect","contextMaxCharacters":4000}',
            ],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )

          const payload = expectJson<{
            ok: boolean
            command: string
            data: {
              outcome: string
              total: number
              success_count: number
              error_count: number
              results: ReadonlyArray<{ ok: boolean; data: { context: string; data: { context: string } } }>
            }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(result.stderr.trim()).toBe("")
          expect(payload.ok).toBe(true)
          expect(payload.command).toBe("web-search")
          expect(payload.data.outcome).toBe("succeeded")
          expect(payload.data.total).toBe(1)
          expect(payload.data.success_count).toBe(1)
          expect(payload.data.error_count).toBe(0)
          expect(payload.data.results[0]?.data.context).toBe("search context")
          expect(server.requests).toHaveLength(1)
          expect(server.requests[0]?.method).toBe("POST")
          expect(server.requests[0]?.path).toBe("/search")
          expect(server.requests[0]?.headers["x-api-key"]).toBe("test-key")
          expect(server.requests[0]?.headers["x-exa-integration"]).toBe("exa-cli-web-search")
          expect(server.requests[0]?.body).toMatchObject({
            query: "Effect Schema",
            type: "instant",
            numResults: 8,
            includeText: ["Effect"],
            contents: {
              text: true,
              context: { maxCharacters: 4000 },
              livecrawl: "fallback",
            },
          })
        }),
    ),
  )

  it.effect("code-context validates token bounds before calling Exa", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        ["code-context", '{"query":"React useState","tokensNum":999}'],
        {
          EXA_API_KEY: "test-key",
        },
      )

      const payload = expectJson<{
        ok: boolean
        command: string
        data: {
          error_count: number
          results: ReadonlyArray<{ ok: boolean; error: { type: string; details?: { field?: string } } }>
        }
      }>(result.stdout)

      expect(result.exitCode).toBe(1)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("code-context")
      expect(payload.data.error_count).toBe(1)
      expect(payload.data.results[0]?.error.type).toBe("CommandInputError")
      expect(payload.data.results[0]?.error.details?.field).toBe("tokensNum")
    }),
  )

  it.effect("crawl accepts JSON via stdin", () =>
    withTestServer(
      async (request, response, record) => {
        const body = await readRequestBody(request)
        record(body)
        writeJson(response, 200, {
          results: [{ id: "https://example.com", text: "page text" }],
        })
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            ["crawl", "-"],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
            {
              stdinText: '{"url":"https://example.com","maxCharacters":1200}',
            },
          )

          const payload = expectJson<{ ok: boolean; command: string }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.ok).toBe(true)
          expect(payload.command).toBe("crawl")
          expect(server.requests[0]?.path).toBe("/contents")
          expect(server.requests[0]?.body).toMatchObject({
            urls: ["https://example.com"],
            contents: {
              text: { maxCharacters: 1200 },
              livecrawl: "preferred",
            },
          })
        }),
    ),
  )

  it.effect("company-research keeps the old provider defaults", () =>
    withTestServer(
      async (request, response, record) => {
        const body = await readRequestBody(request)
        record(body)
        writeJson(response, 200, { results: [] })
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            ["company-research", '{"companyName":"Acme"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )

          expect(result.exitCode).toBe(0)
          expect(server.requests[0]?.path).toBe("/search")
          expect(server.requests[0]?.body).toMatchObject({
            query: "Acme company business corporation information news financial",
            type: "instant",
            includeDomains: expect.arrayContaining(["reuters.com", "sec.gov", "linkedin.com"]),
          })
        }),
    ),
  )

  it.effect("linkedin-search scopes searches to linkedin.com", () =>
    withTestServer(
      async (request, response, record) => {
        const body = await readRequestBody(request)
        record(body)
        writeJson(response, 200, { results: [] })
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            ["linkedin-search", '{"query":"Jane Doe","searchType":"profiles"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )

          expect(result.exitCode).toBe(0)
          expect(server.requests[0]?.body).toMatchObject({
            query: "Jane Doe LinkedIn profile",
            includeDomains: ["linkedin.com"],
          })
        }),
    ),
  )

  it.effect("deep-research start and check use research task endpoints", () =>
    withTestServer(
      async (request, response, record) => {
        const body = await readRequestBody(request)
        record(body)
        if (request.method === "POST") {
          writeJson(response, 201, { researchId: "task_123", status: "running" })
          return
        }

        writeJson(response, 200, {
          researchId: "task_123",
          status: "completed",
          data: { report: "done" },
        })
      },
      (server) =>
        Effect.gen(function* () {
          const start = yield* runCli(
            ["deep-research", "start", '{"instructions":"Research Effect"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )
          const check = yield* runCli(
            ["deep-research", "check", '{"researchId":"task_123"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )

          expect(start.exitCode).toBe(0)
          expect(check.exitCode).toBe(0)
          expect(server.requests[0]?.method).toBe("POST")
          expect(server.requests[0]?.path).toBe("/research/v1")
          expect(server.requests[0]?.body).toMatchObject({
            model: "exa-research",
            instructions: "Research Effect",
          })
          expect(server.requests[1]?.method).toBe("GET")
          expect(server.requests[1]?.path).toBe("/research/v1/task_123")
        }),
    ),
  )

  it.effect("find-similar sends the old findSimilar request shape", () =>
    withTestServer(
      async (request, response, record) => {
        const body = await readRequestBody(request)
        record(body)
        writeJson(response, 200, { results: [] })
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            ["find-similar", '{"url":"https://example.com/article"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )

          expect(result.exitCode).toBe(0)
          expect(server.requests[0]?.path).toBe("/findSimilar")
          expect(server.requests[0]?.body).toMatchObject({
            url: "https://example.com/article",
            numResults: 10,
            contents: { text: true },
          })
        }),
    ),
  )

  it.effect("web-search preserves ordered batch results and exits 1 on partial API failure", () =>
    withTestServer(
      async (request, response, record) => {
        const body = await readRequestBody(request)
        record(body)

        if (
          body &&
          typeof body === "object" &&
          "query" in body &&
          body.query === "rate limited"
        ) {
          writeJson(response, 429, { error: { message: "Too many requests" } })
          return
        }

        writeJson(response, 200, {
          context: "ok context",
          results: [{ id: "ok", url: "https://example.com/ok" }],
        })
      },
      (server) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            [
              "web-search",
              "--concurrency",
              "2",
              '[{"query":"ok"},{"query":"rate limited"}]',
            ],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )

          const payload = expectJson<{
            ok: boolean
            data: {
              outcome: string
              total: number
              success_count: number
              error_count: number
              concurrency: number
              results: ReadonlyArray<{
                index: number
                target?: { query?: string }
                ok: boolean
                error?: { type: string; details?: { status?: number; retryable?: boolean } }
              }>
            }
          }>(result.stdout)

          expect(result.exitCode).toBe(1)
          expect(result.stderr.trim()).toBe("")
          expect(payload.ok).toBe(true)
          expect(payload.data.outcome).toBe("partial_failure")
          expect(payload.data.total).toBe(2)
          expect(payload.data.success_count).toBe(1)
          expect(payload.data.error_count).toBe(1)
          expect(payload.data.concurrency).toBe(2)
          expect(payload.data.results.map((item) => item.index)).toEqual([0, 1])
          expect(payload.data.results[0]?.ok).toBe(true)
          expect(payload.data.results[1]?.target?.query).toBe("rate limited")
          expect(payload.data.results[1]?.error?.type).toBe("ApiResponseError")
          expect(payload.data.results[1]?.error?.details?.status).toBe(429)
          expect(payload.data.results[1]?.error?.details?.retryable).toBe(true)
          expect(server.requests).toHaveLength(2)
        }),
    ),
  )

  it.effect("artifact output writes large crawl results to an artifact", () =>
    withTempDir((artifactDir) =>
      withTestServer(
        async (request, response, record) => {
          const body = await readRequestBody(request)
          record(body)
          writeJson(response, 200, {
            results: [{ id: "https://example.com", text: "page text".repeat(500) }],
          })
        },
        (server) =>
          Effect.gen(function* () {
            const result = yield* runCli(
              ["crawl", "--output", "artifact", '{"url":"https://example.com"}'],
              {
                EXA_API_KEY: "test-key",
                EXA_API_BASE_URL: server.baseUrl,
                EXA_CLI_ARTIFACT_DIR: artifactDir,
              },
            )

            const payload = expectJson<{
              data: {
                results: ReadonlyArray<{
                  ok: boolean
                  data: {
                    kind: string
                    artifact: { absolute_path: string; size_bytes: number }
                  }
                }>
              }
            }>(result.stdout)
            const artifact = payload.data.results[0]?.data.artifact

            expect(result.exitCode).toBe(0)
            expect(payload.data.results[0]?.data.kind).toBe("summary+artifact")
            expect(artifact?.absolute_path.startsWith(artifactDir)).toBe(true)
            expect(artifact?.size_bytes).toBeGreaterThan(0)

            const artifactText = yield* Effect.promise(() => readFile(artifact?.absolute_path ?? "", "utf8"))
            expect(artifactText).toContain("page text")
          }),
      ),
    ),
  )

  it.effect("artifact output defaults under EXA_CLI_HOME", () =>
    withTempDir((cliHome) =>
      withTestServer(
        async (request, response, record) => {
          const body = await readRequestBody(request)
          record(body)
          writeJson(response, 200, {
            results: [{ id: "https://example.com", text: "page text".repeat(500) }],
          })
        },
        (server) =>
          Effect.gen(function* () {
            const result = yield* runCli(
              ["crawl", "--output", "artifact", '{"url":"https://example.com"}'],
              {
                EXA_API_KEY: "test-key",
                EXA_API_BASE_URL: server.baseUrl,
                EXA_CLI_HOME: cliHome,
                EXA_CLI_ARTIFACT_DIR: undefined,
              },
            )

            const payload = expectJson<{
              data: {
                results: ReadonlyArray<{
                  ok: boolean
                  data: {
                    kind: string
                    artifact: { absolute_path: string }
                  }
                }>
              }
            }>(result.stdout)
            const artifact = payload.data.results[0]?.data.artifact

            expect(result.exitCode).toBe(0)
            expect(artifact?.absolute_path.startsWith(join(cliHome, "artifacts"))).toBe(true)
          }),
      ),
    ),
  )

  it.effect("find-similar accepts @file JSON input", () =>
    withTempDir((tempDir) =>
      withTestServer(
        async (request, response, record) => {
          const body = await readRequestBody(request)
          record(body)
          writeJson(response, 200, { results: [] })
        },
        (server) =>
          Effect.gen(function* () {
            const inputPath = join(tempDir, "find-similar.json")
            yield* Effect.promise(() =>
              writeFile(inputPath, JSON.stringify({ url: "https://example.com/from-file" })),
            )

            const result = yield* runCli(["find-similar", `@${inputPath}`], {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            })

            expect(result.exitCode).toBe(0)
            expect(server.requests[0]?.path).toBe("/findSimilar")
            expect(server.requests[0]?.body).toMatchObject({
              url: "https://example.com/from-file",
            })
          }),
      ),
    ),
  )

  it.effect("deep-research exposes lifecycle aliases, wait, events, list, and stream", () =>
    withTestServer(
      async (request, response, record) => {
        const body = await readRequestBody(request)
        record(body)

        if (request.method === "POST") {
          writeJson(response, 201, { researchId: "task_123", status: "running" })
          return
        }

        if (request.url === "/research/v1?limit=2") {
          writeJson(response, 200, {
            data: [{ researchId: "task_123", status: "running" }],
            hasMore: false,
            nextCursor: null,
          })
          return
        }

        if (request.url === "/research/v1/task_123?events=true") {
          writeJson(response, 200, {
            researchId: "task_123",
            status: "completed",
            events: [{ type: "research.completed" }],
          })
          return
        }

        if (request.url === "/research/v1/task_123?stream=true") {
          response.writeHead(200, { "content-type": "text/event-stream" })
          response.end('event: update\ndata: {"status":"running"}\n\nevent: done\ndata: {"status":"completed"}\n\n')
          return
        }

        writeJson(response, 200, {
          researchId: "task_123",
          status: "completed",
          data: { report: "done" },
        })
      },
      (server) =>
        Effect.gen(function* () {
          const run = yield* runCli(
            ["deep-research", "run", '{"instructions":"Research Effect"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )
          const inspect = yield* runCli(
            ["deep-research", "inspect", '{"researchId":"task_123"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )
          const list = yield* runCli(["deep-research", "list", '{"limit":2}'], {
            EXA_API_KEY: "test-key",
            EXA_API_BASE_URL: server.baseUrl,
          })
          const wait = yield* runCli(
            [
              "deep-research",
              "wait",
              '{"researchId":"task_123","intervalMs":1,"timeoutMs":500}',
            ],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )
          const events = yield* runCli(
            ["deep-research", "events", '{"researchId":"task_123"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )
          const stream = yield* runCli(
            ["deep-research", "stream", '{"researchId":"task_123"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )

          const waitPayload = expectJson<{ data: { status: string } }>(wait.stdout)
          const streamPayload = expectJson<{ data: { event_count: number } }>(stream.stdout)

          expect(run.exitCode).toBe(0)
          expect(inspect.exitCode).toBe(0)
          expect(list.exitCode).toBe(0)
          expect(wait.exitCode).toBe(0)
          expect(events.exitCode).toBe(0)
          expect(stream.exitCode).toBe(0)
          expect(waitPayload.data.status).toBe("completed")
          expect(streamPayload.data.event_count).toBe(2)
          expect(server.requests.map((request) => request.path)).toEqual(
            expect.arrayContaining([
              "/research/v1",
              "/research/v1/task_123",
              "/research/v1?limit=2",
              "/research/v1/task_123?events=true",
              "/research/v1/task_123?stream=true",
            ]),
          )
        }),
    ),
  )

  it.effect("discovery commands expose doctor, capabilities, schemas, and examples", () =>
    Effect.gen(function* () {
      const doctor = yield* runCli(["doctor"], {
        EXA_API_KEY: undefined,
        EXA_API_BASE_URL: undefined,
      })
      const capabilities = yield* runCli(["capabilities"], {
        EXA_API_KEY: undefined,
        EXA_API_BASE_URL: undefined,
      })
      const schema = yield* runCli(["schema", "show", "web-search"], {
        EXA_API_KEY: undefined,
        EXA_API_BASE_URL: undefined,
      })
      const examples = yield* runCli(["examples", "show", "batch-search"], {
        EXA_API_KEY: undefined,
        EXA_API_BASE_URL: undefined,
      })

      const doctorPayload = expectJson<{ data: { checks: ReadonlyArray<{ name: string; ok: boolean }> } }>(
        doctor.stdout,
      )
      const capabilitiesPayload = expectJson<{
        data: { deep_research: { lifecycle: ReadonlyArray<{ action: string; supported: boolean }> } }
      }>(capabilities.stdout)
      const schemaPayload = expectJson<{ data: { command: string; batch: boolean; schema: unknown } }>(
        schema.stdout,
      )
      const examplesPayload = expectJson<{ data: { examples: ReadonlyArray<{ name: string }> } }>(
        examples.stdout,
      )

      expect(doctor.exitCode).toBe(0)
      expect(capabilities.exitCode).toBe(0)
      expect(schema.exitCode).toBe(0)
      expect(examples.exitCode).toBe(0)
      expect(doctorPayload.data.checks).toContainEqual(
        expect.objectContaining({ name: "api_key", ok: false }),
      )
      expect(capabilitiesPayload.data.deep_research.lifecycle).toContainEqual(
        expect.objectContaining({ action: "cancel", supported: false }),
      )
      expect(schemaPayload.data.command).toBe("web-search")
      expect(schemaPayload.data.batch).toBe(true)
      expect(schemaPayload.data.schema).toBeTruthy()
      expect(examplesPayload.data.examples[0]?.name).toBe("batch-search")
    }),
  )

  it.effect("--help lists the expanded command surface", () =>
    Effect.gen(function* () {
      const result = yield* runCli(["--help"], {
        EXA_API_KEY: undefined,
        EXA_API_BASE_URL: undefined,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("doctor")
      expect(result.stdout).toContain("capabilities")
      expect(result.stdout).toContain("schema")
      expect(result.stdout).toContain("examples")
      expect(result.stdout).toContain("deep-research wait")
    }),
  )

  it.effect("returns structured error for invalid JSON input", () =>
    Effect.gen(function* () {
      const result = yield* runCli(["web-search", "not-valid-json"], {
        EXA_API_KEY: "test-key",
      })

      const payload = expectJson<{
        ok: boolean
        command: string
        error: {
          type: string
          details?: { source?: string; reason?: string }
        }
      }>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe("")
      expect(payload.ok).toBe(false)
      expect(payload.command).toBe("web-search")
      expect(payload.error.type).toBe("JsonInputError")
      expect(payload.error.details?.source).toBe("inline")
      expect(payload.error.details?.reason).toBe("InvalidJson")
    }),
  )
})

describe("toErrorDetails", () => {
  it.effect("formats ConfigurationError", () =>
    Effect.gen(function* () {
      const error = new ConfigurationError({
        field: "EXA_API_BASE_URL",
        message: "Invalid URL",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ConfigurationError")
      expect(details.message).toBe("Invalid URL")
      expect(details.details).toMatchObject({ field: "EXA_API_BASE_URL", retryable: false })
    }),
  )

  it.effect("formats MissingApiKeyError", () =>
    Effect.gen(function* () {
      const error = new MissingApiKeyError({
        envVar: "EXA_API_KEY",
        hint: "Set your API key",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("MissingApiKeyError")
      expect(details.message).toBe("EXA_API_KEY is not configured")
      expect(details.details).toMatchObject({
        env_var: "EXA_API_KEY",
        hint: "Set your API key",
        retryable: false,
      })
    }),
  )

  it.effect("formats JsonInputError", () =>
    Effect.gen(function* () {
      const error = new JsonInputError({
        source: "inline",
        reason: "InvalidJson",
        message: "Unexpected token",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("JsonInputError")
      expect(details.details).toMatchObject({
        source: "inline",
        reason: "InvalidJson",
        retryable: false,
      })
    }),
  )

  it.effect("formats CommandInputError", () =>
    Effect.gen(function* () {
      const error = new CommandInputError({
        field: "name",
        message: "name must not be empty",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("CommandInputError")
      expect(details.details).toMatchObject({ field: "name", retryable: false })
    }),
  )

  it.effect("formats ApiRequestError", () =>
    Effect.gen(function* () {
      const error = new ApiRequestError({
        method: "POST",
        path: "/search",
        reason: "ConnectionRefused",
        message: "Connection refused",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ApiRequestError")
      expect(details.details).toMatchObject({
        method: "POST",
        path: "/search",
        reason: "ConnectionRefused",
        retryable: true,
      })
    }),
  )

  it.effect("formats ApiResponseError", () =>
    Effect.gen(function* () {
      const error = new ApiResponseError({
        method: "POST",
        path: "/search",
        status: 422,
        message: "Validation failed",
        body: { errors: ["invalid"] },
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ApiResponseError")
      expect(details.details).toMatchObject({
        method: "POST",
        path: "/search",
        status: 422,
        body: { errors: ["invalid"] },
        retryable: false,
      })
    }),
  )

  it.effect("formats ApiDecodeError", () =>
    Effect.gen(function* () {
      const error = new ApiDecodeError({
        method: "GET",
        path: "/research/v1/task_123",
        message: "Unexpected end of JSON input",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ApiDecodeError")
      expect(details.details).toMatchObject({
        method: "GET",
        path: "/research/v1/task_123",
        retryable: true,
      })
    }),
  )
})

describe("JSON input helpers", () => {
  it.effect("loads a typed JSON object", () =>
    Effect.gen(function* () {
      const result = yield* loadJsonInput(Schema.Struct({ query: Schema.String }), '{"query":"test"}').pipe(
        Effect.provide(FileSystem.layerNoop({})),
      )
      expect(result).toEqual({ query: "test" })
    }),
  )

  it.effect("wraps a single object in an array", () =>
    Effect.gen(function* () {
      const result = yield* loadBatchJsonInput('{"name": "test"}').pipe(
        Effect.provide(FileSystem.layerNoop({})),
      )
      expect(result).toEqual([{ name: "test" }])
    }),
  )
})
