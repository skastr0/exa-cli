import { Schema } from "effect"

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "ConfigurationError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class MissingApiKeyError extends Schema.TaggedError<MissingApiKeyError>()(
  "MissingApiKeyError",
  {
    envVar: Schema.String,
    hint: Schema.String,
  },
) {}

export class JsonInputError extends Schema.TaggedError<JsonInputError>()(
  "JsonInputError",
  {
    source: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class CommandInputError extends Schema.TaggedError<CommandInputError>()(
  "CommandInputError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class ApiRequestError extends Schema.TaggedError<ApiRequestError>()(
  "ApiRequestError",
  {
    method: Schema.String,
    path: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class ApiResponseError extends Schema.TaggedError<ApiResponseError>()(
  "ApiResponseError",
  {
    method: Schema.String,
    path: Schema.String,
    status: Schema.Number,
    message: Schema.String,
    body: Schema.NullishOr(Schema.Unknown),
  },
) {}

export class ApiDecodeError extends Schema.TaggedError<ApiDecodeError>()(
  "ApiDecodeError",
  {
    method: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class ArtifactWriteError extends Schema.TaggedError<ArtifactWriteError>()(
  "ArtifactWriteError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class ResearchWaitTimeoutError extends Schema.TaggedError<ResearchWaitTimeoutError>()(
  "ResearchWaitTimeoutError",
  {
    researchId: Schema.String,
    timeoutMs: Schema.Number,
    lastStatus: Schema.NullishOr(Schema.String),
    message: Schema.String,
  },
) {}

export class AgentWaitTimeoutError extends Schema.TaggedError<AgentWaitTimeoutError>()(
  "AgentWaitTimeoutError",
  {
    runId: Schema.String,
    timeoutMs: Schema.Number,
    lastStatus: Schema.NullishOr(Schema.String),
    message: Schema.String,
  },
) {}

export type AppError =
  | ConfigurationError
  | MissingApiKeyError
  | JsonInputError
  | CommandInputError
  | ApiRequestError
  | ApiResponseError
  | ApiDecodeError
  | ArtifactWriteError
  | ResearchWaitTimeoutError
  | AgentWaitTimeoutError
