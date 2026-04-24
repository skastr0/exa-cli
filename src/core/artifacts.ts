import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Effect, Schema } from "effect"

import { ArtifactWriteError } from "./errors"

export const OutputModeSchema = Schema.Literal("inline", "artifact", "auto")
export type OutputMode = typeof OutputModeSchema.Type

const AUTO_ARTIFACT_THRESHOLD_BYTES = 16_000
const ARTIFACT_DIR_ENV = "EXA_CLI_ARTIFACT_DIR"

export interface ArtifactRecord {
  readonly key: string
  readonly kind: "json"
  readonly absolute_path: string
  readonly size_bytes: number
}

export interface ArtifactSummary {
  readonly kind: "summary+artifact"
  readonly summary: string
  readonly artifact: ArtifactRecord
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "output"

const summarizeData = (data: unknown, sizeBytes: number) => {
  if (isRecord(data)) {
    if (Array.isArray(data.results)) {
      return `Wrote ${data.results.length} results (${sizeBytes} bytes) to an artifact.`
    }

    if (isRecord(data.data) && Array.isArray(data.data.results)) {
      return `Wrote ${data.data.results.length} results (${sizeBytes} bytes) to an artifact.`
    }
  }

  return `Wrote ${sizeBytes} bytes to an artifact.`
}

export const getArtifactDirectory = () =>
  resolve(Bun.env[ARTIFACT_DIR_ENV] ?? join(process.cwd(), ".exa-cli", "artifacts"))

export const applyOutputPolicy = (options: {
  readonly command: string
  readonly mode: OutputMode
  readonly data: unknown
  readonly itemIndex?: number
}): Effect.Effect<unknown, ArtifactWriteError> =>
  Effect.gen(function* () {
    const serialized = JSON.stringify(options.data, null, 2)
    const sizeBytes = byteLength(serialized)

    if (
      options.mode === "inline" ||
      (options.mode === "auto" && sizeBytes <= AUTO_ARTIFACT_THRESHOLD_BYTES)
    ) {
      return options.data
    }

    const artifactDir = getArtifactDirectory()
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const suffix = options.itemIndex === undefined ? "result" : `item-${options.itemIndex}`
    const key = `${slugify(options.command)}.${suffix}`
    const path = join(artifactDir, `${timestamp}-${slugify(options.command)}-${suffix}.json`)

    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(artifactDir, { recursive: true })
        await Bun.write(path, serialized)
      },
      catch: (cause) =>
        new ArtifactWriteError({
          path,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    })

    return {
      kind: "summary+artifact",
      summary: summarizeData(options.data, sizeBytes),
      artifact: {
        key,
        kind: "json",
        absolute_path: path,
        size_bytes: sizeBytes,
      },
    } satisfies ArtifactSummary
  })
