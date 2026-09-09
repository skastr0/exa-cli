import { Args, Command, Options } from "@effect/cli"
import { Effect, JSONSchema, Schema } from "effect"

import {
  DEFAULT_BATCH_CONCURRENCY,
  exaCommandContracts,
  type ExaCommandContract,
} from "./exa"
import { getAuthStatus } from "../core/api"
import {
  ARTIFACT_DIR_ENV,
  CLI_DATA_DIR_NAME,
  CLI_HOME_ENV,
  CLI_NAME,
  CLI_VERSION,
} from "../core/constants"
import { CommandInputError } from "../core/errors"
import { executeJsonCommand } from "../core/output"
import { getArtifactDirectory, getCliHomeDirectory } from "../core/runtime"

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit JSON output. This CLI emits JSON envelopes by default."),
)

const nameArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Command or example name"),
)

const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ")

const batchSchema = (contract: ExaCommandContract) =>
  contract.batch ? Schema.Union(contract.schema, Schema.Array(contract.schema)) : contract.schema

const renderSchema = (contract: ExaCommandContract) => JSONSchema.make(batchSchema(contract))

const findContract = (name: string) => {
  const normalized = normalizeName(name)
  return exaCommandContracts.find((contract) => contract.command === normalized)
}

const requireContract = (name: string) =>
  Effect.gen(function* () {
    const contract = findContract(name)
    if (!contract) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "name",
          message: `Unknown command schema: ${name}`,
        }),
      )
    }

    return contract
  })

const cliCapabilities = () => ({
  name: CLI_NAME,
  version: CLI_VERSION,
  shape: "stateless-json-first",
  stdout: "success JSON envelope",
  stderr: "recoverable failure JSON envelope",
})

const runtimeDataCapabilities = () => ({
  home_env: CLI_HOME_ENV,
  home: getCliHomeDirectory(),
  default_home: `~/.config/${CLI_DATA_DIR_NAME}`,
  artifact_dir: getArtifactDirectory(),
  artifact_dir_env: ARTIFACT_DIR_ENV,
  default_artifact_subdir: "artifacts",
  cwd_default: false,
  project_output_requires_explicit_path: true,
})

const batchCapabilities = () => ({
  default_concurrency: DEFAULT_BATCH_CONCURRENCY,
  caller_controlled_with: "--concurrency",
  commands: exaCommandContracts
    .filter((contract) => contract.batch)
    .map((contract) => contract.command),
})

const agentLifecycle = [
  {
    action: "start",
    command: "agent start",
    supported: true,
    provider: "POST /agent/runs",
  },
  {
    action: "run",
    command: "agent run",
    supported: true,
    alias_of: "agent start",
    provider: "POST /agent/runs",
  },
  {
    action: "check",
    command: "agent check",
    supported: true,
    provider: "GET /agent/runs/{id}",
  },
  {
    action: "inspect",
    command: "agent inspect",
    supported: true,
    alias_of: "agent check",
    provider: "GET /agent/runs/{id}",
  },
  {
    action: "list",
    command: "agent list",
    supported: true,
    provider: "GET /agent/runs",
  },
  {
    action: "wait",
    command: "agent wait",
    supported: true,
    provider: "GET /agent/runs/{id}",
  },
  {
    action: "events",
    command: "agent events",
    supported: true,
    provider: "GET /agent/runs/{id}/events",
  },
  {
    action: "stream",
    command: "agent stream",
    supported: true,
    provider: "GET /agent/runs/{id}/events",
    accept: "text/event-stream",
  },
  {
    action: "cancel",
    command: "agent cancel",
    supported: true,
    provider: "POST /agent/runs/{id}/cancel",
  },
  {
    action: "stop",
    command: "agent stop",
    supported: true,
    provider: "POST /agent/runs/{id}/stop",
    note: "Documented for effort max; sends Exa-Beta: agent-max-effort-2026-07-27.",
  },
  {
    action: "delete",
    command: "agent delete",
    supported: true,
    provider: "DELETE /agent/runs/{id}",
  },
] as const

const deepResearchLifecycle = [
  {
    action: "start",
    command: "deep-research start",
    supported: true,
    alias_of: "agent start",
    provider: "POST /agent/runs",
  },
  {
    action: "run",
    command: "deep-research run",
    supported: true,
    alias_of: "deep-research start",
    provider: "POST /agent/runs",
  },
  {
    action: "check",
    command: "deep-research check",
    supported: true,
    alias_of: "agent check",
    provider: "GET /agent/runs/{id}",
  },
  {
    action: "inspect",
    command: "deep-research inspect",
    supported: true,
    alias_of: "deep-research check",
    provider: "GET /agent/runs/{id}",
  },
  {
    action: "list",
    command: "deep-research list",
    supported: true,
    alias_of: "agent list",
    provider: "GET /agent/runs",
  },
  {
    action: "wait",
    command: "deep-research wait",
    supported: true,
    alias_of: "agent wait",
    provider: "GET /agent/runs/{id}",
  },
  {
    action: "events",
    command: "deep-research events",
    supported: true,
    alias_of: "agent events",
    provider: "GET /agent/runs/{id}/events",
  },
  {
    action: "stream",
    command: "deep-research stream",
    supported: true,
    alias_of: "agent stream",
    provider: "GET /agent/runs/{id}/events",
    accept: "text/event-stream",
  },
  {
    action: "cancel",
    command: "deep-research cancel",
    supported: true,
    alias_of: "agent cancel",
    provider: "POST /agent/runs/{id}/cancel",
  },
] as const

const agentCapabilities = () => ({
  provider_api: "/agent/runs",
  lifecycle: agentLifecycle,
})

const deepResearchCapabilities = () => ({
  provider_api: "/agent/runs",
  retired_provider_api: "/research/v1",
  retired_on: "2026-05-01",
  aliases_agent: true,
  provider_notice:
    "Exa retired /research/v1 on 2026-05-01. deep-research commands now alias Agent runs. Synchronous synthesis is web-search type deep-reasoning, which has no task lifecycle.",
  input_mapping: {
    instructions: "query",
    researchId: "id",
    taskId: "id",
  },
  lifecycle: deepResearchLifecycle,
})

const searchCapabilities = () => ({
  provider_api: "POST /search",
  types: ["auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning"],
  removed_types: ["neural"],
  default_type: "auto",
  categories: ["company", "publication", "news", "personal site", "financial report", "people"],
  deprecated_categories: ["research paper", "pdf", "github", "tweet"],
  contents: {
    nested_under: "contents",
    fields: [
      "text",
      "highlights",
      "summary",
      "extras",
      "context",
      "livecrawl",
      "livecrawlTimeout",
      "maxAgeHours",
      "subpages",
      "subpageTarget",
    ],
    deprecated_fields: ["context", "livecrawl"],
  },
})

const contentsCapabilities = () => ({
  provider_api: "POST /contents",
  identifiers: ["ids", "urls", "url"],
  crawl_command: "Thin wrapper around /contents for one URL with text.maxCharacters and maxAgeHours 0.",
})

const answerCapabilities = () => ({
  provider_api: "POST /answer",
  models: ["exa", "exa-pro", "exa-research", "exa-fast"],
  streaming: "JSON field stream=true collects SSE into the success envelope; it is not a live NDJSON stdout mode.",
})

const findSimilarCapabilities = () => ({
  provider_api: "POST /findSimilar",
  deprecated: true,
  provider_notice: "Exa marks /findSimilar deprecated. Prefer web-search with a query describing the source.",
})

export interface CapabilitiesData {
  readonly cli: ReturnType<typeof cliCapabilities>
  readonly input_modes: readonly string[]
  readonly output_modes: readonly string[]
  readonly artifact_dir_env: string
  readonly runtime_data: ReturnType<typeof runtimeDataCapabilities>
  readonly batch: ReturnType<typeof batchCapabilities>
  readonly search: ReturnType<typeof searchCapabilities>
  readonly contents: ReturnType<typeof contentsCapabilities>
  readonly answer: ReturnType<typeof answerCapabilities>
  readonly find_similar: ReturnType<typeof findSimilarCapabilities>
  readonly agent: ReturnType<typeof agentCapabilities>
  readonly deep_research: ReturnType<typeof deepResearchCapabilities>
  readonly schemas: {
    readonly list: string
    readonly show: string
  }
  readonly examples: {
    readonly list: string
    readonly show: string
  }
}

export const capabilitiesData = (): CapabilitiesData => ({
  cli: cliCapabilities(),
  input_modes: ["inline-json", "@file", "-", "@-"],
  output_modes: ["inline", "artifact", "auto"],
  artifact_dir_env: ARTIFACT_DIR_ENV,
  runtime_data: runtimeDataCapabilities(),
  batch: batchCapabilities(),
  search: searchCapabilities(),
  contents: contentsCapabilities(),
  answer: answerCapabilities(),
  find_similar: findSimilarCapabilities(),
  agent: agentCapabilities(),
  deep_research: deepResearchCapabilities(),
  schemas: {
    list: "schema list",
    show: "schema show <command>",
  },
  examples: {
    list: "examples list",
    show: "examples show <command-or-example-name>",
  },
})

const doctorData = (auth: {
  readonly api_base_url: string
  readonly configured: boolean
}) => ({
  cli: {
    name: CLI_NAME,
    version: CLI_VERSION,
  },
  environment: {
    api_base_url: auth.api_base_url,
    api_key_configured: auth.configured,
    cli_home: getCliHomeDirectory(),
    artifact_dir: getArtifactDirectory(),
  },
  checks: [
    {
      name: "api_key",
      ok: auth.configured,
      ...(auth.configured ? {} : { hint: "Set EXA_API_KEY before API commands." }),
    },
    {
      name: "api_base_url",
      ok: true,
      value: auth.api_base_url,
    },
  ],
  capabilities: capabilitiesData(),
})

const doctorCommand = Command.make("doctor", { json: jsonOption }, () =>
  executeJsonCommand(
    "doctor",
    Effect.gen(function* () {
      const auth = yield* getAuthStatus
      return doctorData(auth)
    }),
  ),
).pipe(Command.withDescription("Report CLI readiness and environment configuration"))

const capabilitiesCommand = Command.make("capabilities", { json: jsonOption }, () =>
  executeJsonCommand("capabilities", Effect.succeed(capabilitiesData())),
).pipe(Command.withDescription("Describe supported CLI protocol capabilities"))

const schemaListCommand = Command.make("list", { json: jsonOption }, () =>
  executeJsonCommand(
    "schema list",
    Effect.succeed({
      schemas: exaCommandContracts.map((contract) => ({
        command: contract.command,
        description: contract.description,
        batch: contract.batch,
        lifecycle: contract.lifecycle ?? false,
        deprecated: contract.deprecated ?? false,
      })),
    }),
  ),
).pipe(Command.withDescription("List command input schemas"))

const schemaShowCommand = Command.make(
  "show",
  { name: nameArg, json: jsonOption },
  ({ name }) =>
    executeJsonCommand(
      "schema show",
      requireContract(name).pipe(
        Effect.map((contract) => ({
          command: contract.command,
          description: contract.description,
          batch: contract.batch,
          deprecated: contract.deprecated ?? false,
          output_modes: contract.outputModes,
          ...(contract.domainRules ? { domain_rules: contract.domainRules } : {}),
          schema: renderSchema(contract),
        })),
      ),
    ),
).pipe(Command.withDescription("Show one command input schema"))

const schemaCommand = Command.make("schema").pipe(
  Command.withDescription("Discover command input schemas"),
  Command.withSubcommands([schemaListCommand, schemaShowCommand]),
)

const exampleRows = () =>
  exaCommandContracts.flatMap((contract) =>
    contract.examples.map((example) => ({
      command: contract.command,
      name: example.name,
      input: example.input,
    })),
  )

const examplesListCommand = Command.make("list", { json: jsonOption }, () =>
  executeJsonCommand(
    "examples list",
    Effect.succeed({
      examples: exampleRows().map((example) => ({
        command: example.command,
        name: example.name,
      })),
    }),
  ),
).pipe(Command.withDescription("List command examples"))

const examplesShowCommand = Command.make(
  "show",
  { name: nameArg, json: jsonOption },
  ({ name }) =>
    executeJsonCommand(
      "examples show",
      Effect.gen(function* () {
        const normalized = normalizeName(name)
        const matchingContract = findContract(normalized)
        const rows = matchingContract
          ? matchingContract.examples.map((example) => ({
              command: matchingContract.command,
              name: example.name,
              input: example.input,
            }))
          : exampleRows().filter((example) => example.name === normalized)

        if (rows.length === 0) {
          return yield* Effect.fail(
            new CommandInputError({
              field: "name",
              message: `Unknown example: ${name}`,
            }),
          )
        }

        return { examples: rows }
      }),
    ),
).pipe(Command.withDescription("Show examples for a command or example name"))

const examplesCommand = Command.make("examples").pipe(
  Command.withDescription("Discover copy-pastable JSON examples"),
  Command.withSubcommands([examplesListCommand, examplesShowCommand]),
)

export const discoveryCommands = [
  doctorCommand,
  capabilitiesCommand,
  schemaCommand,
  examplesCommand,
]
