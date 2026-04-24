import { FileSystem, HttpClient } from "@effect/platform"
import { Effect, Schema } from "effect"

import { applyOutputPolicy, type OutputMode } from "./artifacts"
import { CommandInputError, JsonInputError } from "./errors"
import { loadBatchJsonInput } from "./json"
import {
  setExitCode,
  toErrorDetails,
  writeFailureEnvelope,
  writeSuccessEnvelope,
  type ErrorEnvelope,
} from "./output"

export type BatchOutcome = "succeeded" | "partial_failure" | "failed"

export interface BatchItemSuccess {
  readonly index: number
  readonly target?: Record<string, unknown>
  readonly ok: true
  readonly data: unknown
}

export interface BatchItemFailure {
  readonly index: number
  readonly target?: Record<string, unknown>
  readonly ok: false
  readonly error: ErrorEnvelope["error"]
}

export type BatchItemResult = BatchItemSuccess | BatchItemFailure

export interface BatchResult {
  readonly outcome: BatchOutcome
  readonly total: number
  readonly success_count: number
  readonly error_count: number
  readonly concurrency: number
  readonly results: ReadonlyArray<BatchItemResult>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const pickTarget = (value: unknown, fields: ReadonlyArray<string>) => {
  if (!isRecord(value)) {
    return undefined
  }

  const entries = fields.flatMap((field) => {
    const fieldValue = value[field]
    return typeof fieldValue === "string" ||
      typeof fieldValue === "number" ||
      typeof fieldValue === "boolean"
      ? [[field, fieldValue] as const]
      : []
  })

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const decodeBatchItem = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  value: unknown,
  index: number,
) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(
      (error) =>
        new JsonInputError({
          source: `input[${index}]`,
          reason: "SchemaValidation",
          message: error.message,
        }),
    ),
  )

const outcomeFor = (successCount: number, errorCount: number): BatchOutcome => {
  if (errorCount === 0) {
    return "succeeded"
  }

  if (successCount === 0) {
    return "failed"
  }

  return "partial_failure"
}

const validateConcurrency = (concurrency: number) =>
  Number.isInteger(concurrency) && concurrency > 0
    ? Effect.void
    : Effect.fail(
        new CommandInputError({
          field: "concurrency",
          message: "concurrency must be a positive integer",
        }),
      )

export const runBatchJsonCommand = <A, I, R>(options: {
  readonly command: string
  readonly input: string
  readonly schema: Schema.Schema<A, I, R>
  readonly concurrency: number
  readonly outputMode: OutputMode
  readonly targetFields: ReadonlyArray<string>
  readonly run: (input: A) => Effect.Effect<unknown, unknown, HttpClient.HttpClient>
}): Effect.Effect<BatchResult, unknown, FileSystem.FileSystem | HttpClient.HttpClient | R> =>
  Effect.gen(function* () {
    yield* validateConcurrency(options.concurrency)

    const rawItems = yield* loadBatchJsonInput(options.input)
    const results = yield* Effect.forEach(
      rawItems.map((rawItem, index) => ({ rawItem, index })),
      ({ rawItem, index }) => {
        const target = pickTarget(rawItem, options.targetFields)

        return decodeBatchItem(options.schema, rawItem, index).pipe(
          Effect.flatMap((item) =>
            options.run(item).pipe(
              Effect.flatMap((data) =>
                applyOutputPolicy({
                  command: options.command,
                  mode: options.outputMode,
                  data,
                  itemIndex: index,
                }),
              ),
              Effect.map(
                (data): BatchItemSuccess => ({
                  index,
                  ...(target ? { target } : {}),
                  ok: true,
                  data,
                }),
              ),
            ),
          ),
          Effect.catchAll((error) =>
            Effect.succeed({
              index,
              ...(target ? { target } : {}),
              ok: false,
              error: toErrorDetails(error),
            } satisfies BatchItemFailure),
          ),
        )
      },
      { concurrency: options.concurrency },
    )

    const successCount = results.filter((result) => result.ok).length
    const errorCount = results.length - successCount

    return {
      outcome: outcomeFor(successCount, errorCount),
      total: results.length,
      success_count: successCount,
      error_count: errorCount,
      concurrency: options.concurrency,
      results,
    } satisfies BatchResult
  })

export const executeBatchJsonCommand = <R>(
  command: string,
  effect: Effect.Effect<BatchResult, unknown, R>,
) =>
  effect.pipe(
    Effect.flatMap((data) =>
      writeSuccessEnvelope(command, data).pipe(
        Effect.zipRight(data.error_count > 0 ? setExitCode(1) : Effect.void),
      ),
    ),
    Effect.catchAll((error) =>
      setExitCode(1).pipe(Effect.zipRight(writeFailureEnvelope(command, error))),
    ),
  )
