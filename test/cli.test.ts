import { FileSystem } from "@effect/platform"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

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
            data: { context: string; data: { context: string } }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(result.stderr.trim()).toBe("")
          expect(payload.ok).toBe(true)
          expect(payload.command).toBe("web-search")
          expect(payload.data.context).toBe("search context")
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
        error: { type: string; details?: { field?: string } }
      }>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe("")
      expect(payload.ok).toBe(false)
      expect(payload.command).toBe("code-context")
      expect(payload.error.type).toBe("CommandInputError")
      expect(payload.error.details?.field).toBe("tokensNum")
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
            ids: ["https://example.com"],
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
          writeJson(response, 200, { id: "task_123" })
          return
        }

        writeJson(response, 200, {
          id: "task_123",
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
            ["deep-research", "check", '{"taskId":"task_123"}'],
            {
              EXA_API_KEY: "test-key",
              EXA_API_BASE_URL: server.baseUrl,
            },
          )

          expect(start.exitCode).toBe(0)
          expect(check.exitCode).toBe(0)
          expect(server.requests[0]?.method).toBe("POST")
          expect(server.requests[0]?.path).toBe("/research/v0/tasks")
          expect(server.requests[0]?.body).toMatchObject({
            model: "exa-research",
            instructions: "Research Effect",
            output: { inferSchema: false },
          })
          expect(server.requests[1]?.method).toBe("GET")
          expect(server.requests[1]?.path).toBe("/research/v0/tasks/task_123")
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
      expect(details.details).toEqual({ field: "EXA_API_BASE_URL" })
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
      expect(details.details).toEqual({
        env_var: "EXA_API_KEY",
        hint: "Set your API key",
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
      expect(details.details).toEqual({
        source: "inline",
        reason: "InvalidJson",
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
      expect(details.details).toEqual({ field: "name" })
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
      expect(details.details).toEqual({
        method: "POST",
        path: "/search",
        reason: "ConnectionRefused",
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
      expect(details.details).toEqual({
        method: "POST",
        path: "/search",
        status: 422,
        body: { errors: ["invalid"] },
      })
    }),
  )

  it.effect("formats ApiDecodeError", () =>
    Effect.gen(function* () {
      const error = new ApiDecodeError({
        method: "GET",
        path: "/research/v0/tasks/task_123",
        message: "Unexpected end of JSON input",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ApiDecodeError")
      expect(details.details).toEqual({
        method: "GET",
        path: "/research/v0/tasks/task_123",
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
