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

const deepResearchLifecycle = [
  {
    action: "start",
    command: "deep-research start",
    supported: true,
    provider: "POST /research/v1",
  },
  {
    action: "run",
    command: "deep-research run",
    supported: true,
    alias_of: "deep-research start",
    provider: "POST /research/v1",
  },
  {
    action: "check",
    command: "deep-research check",
    supported: true,
    provider: "GET /research/v1/{researchId}",
  },
  {
    action: "inspect",
    command: "deep-research inspect",
    supported: true,
    alias_of: "deep-research check",
    provider: "GET /research/v1/{researchId}",
  },
  {
    action: "list",
    command: "deep-research list",
    supported: true,
    provider: "GET /research/v1",
  },
  {
    action: "wait",
    command: "deep-research wait",
    supported: true,
    provider: "GET /research/v1/{researchId}",
  },
  {
    action: "events",
    command: "deep-research events",
    supported: true,
    provider: "GET /research/v1/{researchId}?events=true",
  },
  {
    action: "stream",
    command: "deep-research stream",
    supported: true,
    provider: "GET /research/v1/{researchId}?stream=true",
  },
  {
    action: "cancel",
    supported: false,
    reason: "No official research task cancel endpoint was documented when checked on 2026-04-24.",
  },
] as const

const deepResearchCapabilities = () => ({
  provider_api: "/research/v1",
  provider_notice:
    "Exa docs mark /research/v1 deprecated on 2026-05-01; migrate to /search type deep-reasoning when provider lifecycle parity exists.",
  lifecycle: deepResearchLifecycle,
})

export interface CapabilitiesData {
  readonly cli: ReturnType<typeof cliCapabilities>
  readonly input_modes: readonly string[]
  readonly output_modes: readonly string[]
  readonly artifact_dir_env: string
  readonly runtime_data: ReturnType<typeof runtimeDataCapabilities>
  readonly batch: ReturnType<typeof batchCapabilities>
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
