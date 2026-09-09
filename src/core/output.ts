import * as Cause from "effect/Cause"
import { Effect } from "effect"

import { ARTIFACT_DIR_ENV, CLI_HOME_ENV } from "./constants"

interface SuccessEnvelope {
  readonly ok: true
  readonly command: string
  readonly data: unknown
}

export interface ErrorEnvelope {
  readonly ok: false
  readonly command?: string
  readonly error: {
    readonly type: string
    readonly message: string
    readonly details?: unknown
  }
}

const writeLine = (stream: NodeJS.WriteStream, text: string) =>
  Effect.sync(() => {
    stream.write(`${text}\n`)
  })

export const setExitCode = (exitCode: number) =>
  Effect.sync(() => {
    process.exitCode = exitCode
  })

const isTaggedError = (
  error: unknown,
): error is Error & { _tag: string; message: string; [key: string]: unknown } =>
  error instanceof Error &&
  "_tag" in error &&
  typeof (error as Record<string, unknown>)._tag === "string"

const redactKeys = new Set([
  "api_key",
  "apikey",
  "authorization",
  "password",
  "secret",
  "token",
  "x-api-key",
])

const sanitizeForDetails = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeForDetails)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        redactKeys.has(key.toLowerCase()) ? "[redacted]" : sanitizeForDetails(nestedValue),
      ]),
    )
  }

  return value
}

const isRetryableStatus = (status: number) =>
  status === 408 || status === 409 || status === 429 || status >= 500

export const toErrorDetails = (error: unknown): ErrorEnvelope["error"] => {
  if (isTaggedError(error)) {
    switch (error._tag) {
      case "ConfigurationError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            field: error.field as string,
            retryable: false,
            hint: "Fix the configuration value and rerun the command.",
          },
        }
      }
      case "MissingApiKeyError": {
        return {
          type: error._tag,
          message: `${error.envVar as string} is not configured`,
          details: {
            env_var: error.envVar as string,
            hint: error.hint as string,
            next_step: `Set ${error.envVar as string} in the environment before retrying.`,
            retryable: false,
          },
        }
      }
      case "JsonInputError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            source: error.source as string,
            reason: error.reason as string,
            hint: "Provide a JSON object, JSON array, @file path, -, or @- input.",
            retryable: false,
          },
        }
      }
      case "CommandInputError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            field: error.field as string,
            hint: "Correct the field value and rerun the command.",
            retryable: false,
          },
        }
      }
      case "ApiRequestError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            method: error.method as string,
            path: error.path as string,
            reason: error.reason as string,
            hint: "Check network connectivity, API base URL, and Exa service availability.",
            retryable: true,
          },
        }
      }
      case "ApiResponseError": {
        const status = error.status as number

        return {
          type: error._tag,
          message: error.message,
          details: {
            method: error.method as string,
            path: error.path as string,
            status,
            body: sanitizeForDetails(error.body),
            hint: isRetryableStatus(status)
              ? "Retry after the provider recovers or rate limits reset."
              : "Inspect the request payload and provider error body.",
            retryable: isRetryableStatus(status),
          },
        }
      }
      case "ApiDecodeError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            method: error.method as string,
            path: error.path as string,
            hint: "The provider returned a response that does not match the expected JSON contract.",
            retryable: true,
          },
        }
      }
      case "ArtifactWriteError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            path: error.path as string,
            hint: `Check that the artifact directory is writable or set ${CLI_HOME_ENV} or ${ARTIFACT_DIR_ENV}.`,
            retryable: false,
          },
        }
      }
      case "ResearchWaitTimeoutError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            research_id: error.researchId as string,
            timeout_ms: error.timeoutMs as number,
            last_status: error.lastStatus,
            hint: "Inspect the research task later or rerun wait with a larger timeoutMs.",
            retryable: true,
          },
        }
      }
      case "AgentWaitTimeoutError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            run_id: error.runId as string,
            timeout_ms: error.timeoutMs as number,
            last_status: error.lastStatus,
            hint: "Inspect the agent run later or rerun wait with a larger timeoutMs.",
            retryable: true,
          },
        }
      }
    }
  }

  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message,
    }
  }

  return {
    type: "Error",
    message: String(error),
  }
}

export const renderSuccessEnvelope = (command: string, data: unknown) =>
  JSON.stringify(
    {
      ok: true,
      command,
      data,
    } satisfies SuccessEnvelope,
    null,
    2,
  )

export const renderFailureEnvelope = (command: string | undefined, error: unknown) =>
  JSON.stringify(
    {
      ok: false,
      ...(command ? { command } : {}),
      error: toErrorDetails(error),
    } satisfies ErrorEnvelope,
    null,
    2,
  )

export const writeSuccessEnvelope = (command: string, data: unknown) =>
  writeLine(process.stdout, renderSuccessEnvelope(command, data))

export const writeFailureEnvelope = (command: string | undefined, error: unknown) =>
  writeLine(process.stderr, renderFailureEnvelope(command, error))

export const writeCauseEnvelope = (command: string | undefined, cause: Cause.Cause<unknown>) =>
  writeLine(
    process.stderr,
    JSON.stringify(
      {
        ok: false,
        ...(command ? { command } : {}),
        error: {
          type: "UnexpectedError",
          message: Cause.pretty(cause),
        },
      } satisfies ErrorEnvelope,
      null,
      2,
    ),
  )

export const executeJsonCommand = <A, E, R>(command: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flatMap((data) => writeSuccessEnvelope(command, data)),
    Effect.catchAll((error) =>
      setExitCode(1).pipe(Effect.zipRight(writeFailureEnvelope(command, error))),
    ),
  )
