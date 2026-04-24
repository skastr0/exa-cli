import { Args, Command, Options } from "@effect/cli"
import { HttpClient } from "@effect/platform"
import { Effect, Schema } from "effect"

import { applyOutputPolicy, type OutputMode } from "../core/artifacts"
import { executeBatchJsonCommand, runBatchJsonCommand } from "../core/batch"
import { requestJson, requestText } from "../core/api"
import { CommandInputError, JsonInputError, ResearchWaitTimeoutError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"

const DEFAULT_NUM_RESULTS = 8
const DEFAULT_MAX_CHARACTERS = 2000
const DEFAULT_CONTEXT_MAX_CHARACTERS = 10000
const DEFAULT_CODE_TOKENS = 5000
const DEFAULT_SIMILAR_RESULTS = 10
export const DEFAULT_BATCH_CONCURRENCY = 5
const DEFAULT_WAIT_INTERVAL_MS = 2000
const DEFAULT_WAIT_TIMEOUT_MS = 180_000

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const outputModeOption = Options.choice("output", ["inline", "artifact", "auto"] as const).pipe(
  Options.withDefault("inline" as const),
  Options.withDescription("Output policy for large results"),
)

const concurrencyOption = Options.integer("concurrency").pipe(
  Options.withDefault(DEFAULT_BATCH_CONCURRENCY),
  Options.withDescription("Maximum number of batch items to run at once"),
)

const UnknownRecord = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
})

const SearchType = Schema.Literal("neural", "auto", "fast", "deep", "instant")
const LivecrawlMode = Schema.Literal("fallback", "preferred")
const SearchCategory = Schema.Literal(
  "company",
  "research paper",
  "news",
  "pdf",
  "github",
  "tweet",
  "personal site",
  "financial report",
  "people",
)
const SearchTextFilter = Schema.Union(Schema.String, Schema.Array(Schema.String))

export const WebSearchInputSchema = Schema.Struct({
  query: Schema.String,
  numResults: Schema.optional(Schema.Number),
  livecrawl: Schema.optional(LivecrawlMode),
  type: Schema.optional(SearchType),
  contextMaxCharacters: Schema.optional(Schema.Number),
  category: Schema.optional(SearchCategory),
  includeDomains: Schema.optional(Schema.Array(Schema.String)),
  excludeDomains: Schema.optional(Schema.Array(Schema.String)),
  startPublishedDate: Schema.optional(Schema.String),
  endPublishedDate: Schema.optional(Schema.String),
  includeText: Schema.optional(SearchTextFilter),
  excludeText: Schema.optional(SearchTextFilter),
})

export const CodeContextInputSchema = Schema.Struct({
  query: Schema.String,
  tokensNum: Schema.optional(Schema.Number),
  flags: Schema.optional(Schema.Array(Schema.String)),
})

export const CrawlInputSchema = Schema.Struct({
  url: Schema.String,
  maxCharacters: Schema.optional(Schema.Number),
})

export const CompanyResearchInputSchema = Schema.Struct({
  companyName: Schema.String,
  numResults: Schema.optional(Schema.Number),
})

export const LinkedinSearchInputSchema = Schema.Struct({
  query: Schema.String,
  searchType: Schema.optional(Schema.Literal("profiles", "companies", "all")),
  numResults: Schema.optional(Schema.Number),
})

export const DeepResearchStartInputSchema = Schema.Struct({
  instructions: Schema.String,
  model: Schema.optional(Schema.Literal("exa-research-fast", "exa-research", "exa-research-pro")),
  outputSchema: Schema.optional(UnknownRecord),
})

export const DeepResearchCheckInputSchema = Schema.Struct({
  researchId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
})

export const DeepResearchListInputSchema = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})

export const DeepResearchWaitInputSchema = Schema.Struct({
  researchId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  intervalMs: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
  events: Schema.optional(Schema.Boolean),
})

export const FindSimilarInputSchema = Schema.Struct({
  url: Schema.String,
  numResults: Schema.optional(Schema.Number),
  includeDomains: Schema.optional(Schema.Array(Schema.String)),
  excludeDomains: Schema.optional(Schema.Array(Schema.String)),
  startPublishedDate: Schema.optional(Schema.String),
  endPublishedDate: Schema.optional(Schema.String),
})

type WebSearchInput = typeof WebSearchInputSchema.Type
type CodeContextInput = typeof CodeContextInputSchema.Type
type CrawlInput = typeof CrawlInputSchema.Type
type CompanyResearchInput = typeof CompanyResearchInputSchema.Type
type LinkedinSearchInput = typeof LinkedinSearchInputSchema.Type
type DeepResearchStartInput = typeof DeepResearchStartInputSchema.Type
type DeepResearchCheckInput = typeof DeepResearchCheckInputSchema.Type
type DeepResearchListInput = typeof DeepResearchListInputSchema.Type
type DeepResearchWaitInput = typeof DeepResearchWaitInputSchema.Type
type FindSimilarInput = typeof FindSimilarInputSchema.Type

export interface ExaCommandContract {
  readonly command: string
  readonly description: string
  readonly schema: Schema.Schema.AnyNoContext
  readonly batch: boolean
  readonly outputModes: ReadonlyArray<OutputMode>
  readonly examples: ReadonlyArray<{
    readonly name: string
    readonly input: unknown
  }>
  readonly domainRules?: ReadonlyArray<string>
  readonly lifecycle?: boolean
}

const outputModes = ["inline", "artifact", "auto"] as const

export const exaCommandContracts: ReadonlyArray<ExaCommandContract> = [
  {
    command: "web-search",
    description: "Search the web with Exa.",
    schema: WebSearchInputSchema,
    batch: true,
    outputModes,
    examples: [
      { name: "single-search", input: { query: "Effect Schema", numResults: 5 } },
      {
        name: "batch-search",
        input: [{ query: "Effect Schema" }, { query: "Effect CLI" }],
      },
    ],
  },
  {
    command: "code-context",
    description: "Fetch Exa code context.",
    schema: CodeContextInputSchema,
    batch: true,
    outputModes,
    examples: [{ name: "react-hooks", input: { query: "React useState examples", tokensNum: 5000 } }],
  },
  {
    command: "crawl",
    description: "Fetch page contents for a URL.",
    schema: CrawlInputSchema,
    batch: true,
    outputModes,
    examples: [{ name: "crawl-page", input: { url: "https://example.com", maxCharacters: 3000 } }],
  },
  {
    command: "company-research",
    description: "Search company-focused sources.",
    schema: CompanyResearchInputSchema,
    batch: true,
    outputModes,
    examples: [{ name: "company", input: { companyName: "Acme", numResults: 5 } }],
  },
  {
    command: "linkedin-search",
    description: "Search LinkedIn profiles or companies.",
    schema: LinkedinSearchInputSchema,
    batch: true,
    outputModes,
    examples: [{ name: "profiles", input: { query: "Jane Doe", searchType: "profiles" } }],
  },
  {
    command: "find-similar",
    description: "Find pages similar to a URL.",
    schema: FindSimilarInputSchema,
    batch: true,
    outputModes,
    examples: [{ name: "similar", input: { url: "https://example.com/article" } }],
  },
  {
    command: "deep-research start",
    description: "Start an asynchronous Exa research task.",
    schema: DeepResearchStartInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    examples: [{ name: "start", input: { instructions: "Research the Exa API" } }],
  },
  {
    command: "deep-research run",
    description: "Alias for starting an asynchronous Exa research task.",
    schema: DeepResearchStartInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    examples: [{ name: "run", input: { instructions: "Research the Exa API" } }],
  },
  {
    command: "deep-research check",
    description: "Inspect a research task by id.",
    schema: DeepResearchCheckInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either researchId or taskId."],
    examples: [{ name: "check", input: { researchId: "01jszdfs0052sg4jc552sg4jc5" } }],
  },
  {
    command: "deep-research inspect",
    description: "Alias for inspecting a research task by id.",
    schema: DeepResearchCheckInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either researchId or taskId."],
    examples: [{ name: "inspect", input: { researchId: "01jszdfs0052sg4jc552sg4jc5" } }],
  },
  {
    command: "deep-research list",
    description: "List research tasks.",
    schema: DeepResearchListInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    examples: [{ name: "list", input: { limit: 10 } }],
  },
  {
    command: "deep-research wait",
    description: "Poll a research task until it reaches a terminal status.",
    schema: DeepResearchWaitInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either researchId or taskId."],
    examples: [
      {
        name: "wait",
        input: { researchId: "01jszdfs0052sg4jc552sg4jc5", intervalMs: 2000, timeoutMs: 180000 },
      },
    ],
  },
  {
    command: "deep-research events",
    description: "Fetch research event log data.",
    schema: DeepResearchCheckInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either researchId or taskId."],
    examples: [{ name: "events", input: { researchId: "01jszdfs0052sg4jc552sg4jc5" } }],
  },
  {
    command: "deep-research stream",
    description: "Collect provider SSE updates for a research task.",
    schema: DeepResearchCheckInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either researchId or taskId."],
    examples: [{ name: "stream", input: { researchId: "01jszdfs0052sg4jc552sg4jc5" } }],
  },
]

const asTextArray = (value: string | ReadonlyArray<string> | undefined) =>
  typeof value === "string" ? [value] : value

const validateNonEmpty = (field: string, value: string) =>
  value.trim().length === 0
    ? Effect.fail(
        new CommandInputError({
          field,
          message: `${field} must not be empty`,
        }),
      )
    : Effect.void

const validatePositiveInteger = (field: string, value: number | undefined) =>
  value !== undefined && (!Number.isInteger(value) || value <= 0)
    ? Effect.fail(
        new CommandInputError({
          field,
          message: `${field} must be a positive integer`,
        }),
      )
    : Effect.void

const validatePositiveNumber = (field: string, value: number | undefined) =>
  value !== undefined && value <= 0
    ? Effect.fail(
        new CommandInputError({
          field,
          message: `${field} must be positive`,
        }),
      )
    : Effect.void

const validateUrl = (field: string, value: string) =>
  Effect.try({
    try: () => new URL(value),
    catch: () =>
      new CommandInputError({
        field,
        message: `${field} must be a valid URL`,
      }),
  }).pipe(Effect.asVoid)

const loadCommandInput = <A, I, R>(schema: Schema.Schema<A, I, R>, input: string) =>
  loadJsonInput(schema, input).pipe(
    Effect.mapError((error) =>
      error instanceof JsonInputError
        ? new JsonInputError({
            source: error.source,
            reason: error.reason,
            message: error.message,
          })
        : error,
    ),
  )

const appendQuery = (path: string, params: Record<string, string | number | boolean | undefined>) => {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value))
    }
  }

  const query = searchParams.toString()
  return query.length > 0 ? `${path}?${query}` : path
}

const resolveResearchId = (input: {
  readonly researchId?: string | undefined
  readonly taskId?: string | undefined
}) =>
  Effect.gen(function* () {
    const researchId =
      input.researchId && input.researchId.trim().length > 0 ? input.researchId : input.taskId

    if (!researchId || researchId.trim().length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "researchId",
          message: "researchId or taskId must not be empty",
        }),
      )
    }

    return researchId
  })

const extractStatus = (data: unknown) =>
  data && typeof data === "object" && "status" in data && typeof data.status === "string"
    ? data.status
    : undefined

const isTerminalResearchStatus = (status: string | undefined) =>
  status === "completed" || status === "canceled" || status === "failed"

const parseSse = (text: string) =>
  text
    .split(/\n\s*\n/g)
    .map((chunk) => {
      const event: Record<string, unknown> = {}
      const dataLines: string[] = []

      for (const line of chunk.split(/\r?\n/g)) {
        if (line.startsWith("event:")) {
          event.event = line.slice("event:".length).trim()
        } else if (line.startsWith("id:")) {
          event.id = line.slice("id:".length).trim()
        } else if (line.startsWith("retry:")) {
          event.retry = Number(line.slice("retry:".length).trim())
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim())
        }
      }

      if (dataLines.length === 0 && Object.keys(event).length === 0) {
        return undefined
      }

      const dataText = dataLines.join("\n")
      if (dataText.length > 0) {
        try {
          event.data = JSON.parse(dataText) as unknown
        } catch {
          event.data = dataText
        }
      }

      return event
    })
    .filter((event): event is Record<string, unknown> => event !== undefined)

const webSearch = (input: WebSearchInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("query", input.query)
    yield* validatePositiveInteger("numResults", input.numResults)
    yield* validatePositiveInteger("contextMaxCharacters", input.contextMaxCharacters)

    const body = {
      query: input.query,
      type: input.type ?? "instant",
      numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
      contents: {
        text: true,
        context: {
          maxCharacters: input.contextMaxCharacters ?? DEFAULT_CONTEXT_MAX_CHARACTERS,
        },
        livecrawl: input.livecrawl ?? "fallback",
      },
      ...(input.category ? { category: input.category } : {}),
      ...(input.includeDomains ? { includeDomains: input.includeDomains } : {}),
      ...(input.excludeDomains ? { excludeDomains: input.excludeDomains } : {}),
      ...(input.startPublishedDate ? { startPublishedDate: input.startPublishedDate } : {}),
      ...(input.endPublishedDate ? { endPublishedDate: input.endPublishedDate } : {}),
      ...(input.includeText ? { includeText: asTextArray(input.includeText) } : {}),
      ...(input.excludeText ? { excludeText: asTextArray(input.excludeText) } : {}),
    }

    const data = yield* requestJson({
      method: "POST",
      path: "/search",
      integration: "exa-cli-web-search",
      body,
      responseSchema: UnknownRecord,
    })

    return {
      context:
        data && typeof data === "object" && "context" in data ? data.context : undefined,
      data,
    }
  })

const codeContext = (input: CodeContextInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("query", input.query)
    yield* validatePositiveInteger("tokensNum", input.tokensNum)

    const tokensNum = input.tokensNum ?? DEFAULT_CODE_TOKENS
    if (tokensNum < 1000 || tokensNum > 50000) {
      yield* Effect.fail(
        new CommandInputError({
          field: "tokensNum",
          message: "tokensNum must be between 1000 and 50000",
        }),
      )
    }

    const data = yield* requestJson({
      method: "POST",
      path: "/context",
      integration: "exa-cli-code-context",
      body: {
        query: input.query,
        tokensNum,
        ...(input.flags ? { flags: input.flags } : {}),
      },
      responseSchema: UnknownRecord,
    })

    return {
      context:
        data && typeof data === "object" && "response" in data ? data.response : undefined,
      data,
    }
  })

const crawl = (input: CrawlInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("url", input.url)
    yield* validateUrl("url", input.url)
    yield* validatePositiveInteger("maxCharacters", input.maxCharacters)

    return yield* requestJson({
      method: "POST",
      path: "/contents",
      integration: "exa-cli-crawling",
      body: {
        urls: [input.url],
        contents: {
          text: { maxCharacters: input.maxCharacters ?? DEFAULT_MAX_CHARACTERS },
          livecrawl: "preferred",
        },
      },
      responseSchema: UnknownRecord,
    })
  })

const companyResearch = (input: CompanyResearchInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("companyName", input.companyName)
    yield* validatePositiveInteger("numResults", input.numResults)

    return yield* requestJson({
      method: "POST",
      path: "/search",
      integration: "exa-cli-company-research",
      body: {
        query: `${input.companyName} company business corporation information news financial`,
        type: "instant",
        numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
        contents: {
          text: { maxCharacters: DEFAULT_MAX_CHARACTERS },
          livecrawl: "preferred",
        },
        includeDomains: [
          "bloomberg.com",
          "reuters.com",
          "crunchbase.com",
          "sec.gov",
          "linkedin.com",
          "forbes.com",
          "businesswire.com",
          "prnewswire.com",
        ],
      },
      responseSchema: UnknownRecord,
    })
  })

const linkedinSearch = (input: LinkedinSearchInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("query", input.query)
    yield* validatePositiveInteger("numResults", input.numResults)

    const searchType = input.searchType ?? "all"
    const query =
      searchType === "profiles"
        ? `${input.query} LinkedIn profile`
        : searchType === "companies"
          ? `${input.query} LinkedIn company`
          : `${input.query} LinkedIn`

    return yield* requestJson({
      method: "POST",
      path: "/search",
      integration: "exa-cli-linkedin-search",
      body: {
        query,
        type: "instant",
        numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
        contents: {
          text: { maxCharacters: DEFAULT_MAX_CHARACTERS },
          livecrawl: "preferred",
        },
        includeDomains: ["linkedin.com"],
      },
      responseSchema: UnknownRecord,
    })
  })

const deepResearchStart = (input: DeepResearchStartInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("instructions", input.instructions)

    const model = input.model ?? "exa-research"
    const data = yield* requestJson({
      method: "POST",
      path: "/research/v1",
      integration: "exa-cli-deep-research",
      body: {
        model,
        instructions: input.instructions,
        ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
      },
      responseSchema: UnknownRecord,
    })

    return {
      researchId:
        data && typeof data === "object" && "researchId" in data ? data.researchId : undefined,
      model,
      instructions: input.instructions,
      data,
    }
  })

const deepResearchCheck = (input: DeepResearchCheckInput) =>
  Effect.gen(function* () {
    const researchId = yield* resolveResearchId(input)

    return yield* requestJson({
      method: "GET",
      path: `/research/v1/${encodeURIComponent(researchId)}`,
      integration: "exa-cli-deep-research",
      responseSchema: UnknownRecord,
    })
  })

const deepResearchList = (input: DeepResearchListInput) =>
  Effect.gen(function* () {
    yield* validatePositiveInteger("limit", input.limit)

    return yield* requestJson({
      method: "GET",
      path: appendQuery("/research/v1", {
        cursor: input.cursor,
        limit: input.limit,
      }),
      integration: "exa-cli-deep-research",
      responseSchema: UnknownRecord,
    })
  })

const deepResearchEvents = (input: DeepResearchCheckInput) =>
  Effect.gen(function* () {
    const researchId = yield* resolveResearchId(input)

    return yield* requestJson({
      method: "GET",
      path: appendQuery(`/research/v1/${encodeURIComponent(researchId)}`, { events: true }),
      integration: "exa-cli-deep-research",
      responseSchema: UnknownRecord,
    })
  })

const deepResearchStream = (input: DeepResearchCheckInput) =>
  Effect.gen(function* () {
    const researchId = yield* resolveResearchId(input)
    const text = yield* requestText({
      method: "GET",
      path: appendQuery(`/research/v1/${encodeURIComponent(researchId)}`, { stream: true }),
      integration: "exa-cli-deep-research",
    })
    const events = parseSse(text)

    return {
      researchId,
      event_count: events.length,
      events,
      ...(events.length === 0 && text.trim().length > 0 ? { raw: text } : {}),
    }
  })

const deepResearchWait = (input: DeepResearchWaitInput) =>
  Effect.gen(function* () {
    const researchId = yield* resolveResearchId(input)
    yield* validatePositiveInteger("intervalMs", input.intervalMs)
    yield* validatePositiveInteger("timeoutMs", input.timeoutMs)
    yield* validatePositiveNumber("timeoutMs", input.timeoutMs)

    const intervalMs = input.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS
    const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    const startedAt = Date.now()
    let latest: unknown
    let lastStatus: string | undefined

    while (Date.now() - startedAt <= timeoutMs) {
      latest = yield* requestJson({
        method: "GET",
        path: appendQuery(`/research/v1/${encodeURIComponent(researchId)}`, {
          events: input.events ? true : undefined,
        }),
        integration: "exa-cli-deep-research",
        responseSchema: UnknownRecord,
      })
      lastStatus = extractStatus(latest)

      if (isTerminalResearchStatus(lastStatus)) {
        return {
          researchId,
          status: lastStatus,
          elapsed_ms: Date.now() - startedAt,
          data: latest,
        }
      }

      yield* Effect.sleep(intervalMs)
    }

    return yield* Effect.fail(
      new ResearchWaitTimeoutError({
        researchId,
        timeoutMs,
        lastStatus,
        message: `Timed out waiting for research task ${researchId}`,
      }),
    )
  })

const findSimilar = (input: FindSimilarInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("url", input.url)
    yield* validateUrl("url", input.url)
    yield* validatePositiveInteger("numResults", input.numResults)

    return yield* requestJson({
      method: "POST",
      path: "/findSimilar",
      integration: "exa-cli-find-similar",
      body: {
        url: input.url,
        numResults: input.numResults ?? DEFAULT_SIMILAR_RESULTS,
        ...(input.includeDomains ? { includeDomains: input.includeDomains } : {}),
        ...(input.excludeDomains ? { excludeDomains: input.excludeDomains } : {}),
        ...(input.startPublishedDate ? { startPublishedDate: input.startPublishedDate } : {}),
        ...(input.endPublishedDate ? { endPublishedDate: input.endPublishedDate } : {}),
        contents: { text: true },
      },
      responseSchema: UnknownRecord,
    })
  })

const makeJsonCommand = <A, I, R>(options: {
  readonly name: string
  readonly commandName: string
  readonly description: string
  readonly schema: Schema.Schema<A, I, R>
  readonly run: (input: A) => Effect.Effect<unknown, unknown, HttpClient.HttpClient>
}) =>
  Command.make(options.name, { input: jsonInputArg, output: outputModeOption }, ({ input, output }) =>
    executeJsonCommand(
      options.commandName,
      loadCommandInput(options.schema, input).pipe(
        Effect.flatMap(options.run),
        Effect.flatMap((data) =>
          applyOutputPolicy({
            command: options.commandName,
            mode: output as OutputMode,
            data,
          }),
        ),
      ),
    ),
  ).pipe(Command.withDescription(options.description))

const makeBatchJsonCommand = <A, I, R>(options: {
  readonly name: string
  readonly commandName: string
  readonly description: string
  readonly schema: Schema.Schema<A, I, R>
  readonly targetFields: ReadonlyArray<string>
  readonly run: (input: A) => Effect.Effect<unknown, unknown, HttpClient.HttpClient>
}) =>
  Command.make(
    options.name,
    { input: jsonInputArg, output: outputModeOption, concurrency: concurrencyOption },
    ({ input, output, concurrency }) =>
      executeBatchJsonCommand(
        options.commandName,
        runBatchJsonCommand({
          command: options.commandName,
          input,
          schema: options.schema,
          concurrency,
          outputMode: output as OutputMode,
          targetFields: options.targetFields,
          run: options.run,
        }),
      ),
  ).pipe(Command.withDescription(options.description))

const deepResearchCommand = Command.make("deep-research").pipe(
  Command.withDescription("Manage Exa deep research tasks"),
  Command.withSubcommands([
    makeJsonCommand({
      name: "start",
      commandName: "deep-research start",
      description: "Start a deep research task from JSON input",
      schema: DeepResearchStartInputSchema,
      run: deepResearchStart,
    }),
    makeJsonCommand({
      name: "run",
      commandName: "deep-research run",
      description: "Alias for starting a deep research task from JSON input",
      schema: DeepResearchStartInputSchema,
      run: deepResearchStart,
    }),
    makeJsonCommand({
      name: "check",
      commandName: "deep-research check",
      description: "Check a deep research task from JSON input",
      schema: DeepResearchCheckInputSchema,
      run: deepResearchCheck,
    }),
    makeJsonCommand({
      name: "inspect",
      commandName: "deep-research inspect",
      description: "Alias for checking a deep research task from JSON input",
      schema: DeepResearchCheckInputSchema,
      run: deepResearchCheck,
    }),
    makeJsonCommand({
      name: "list",
      commandName: "deep-research list",
      description: "List deep research tasks from JSON input",
      schema: DeepResearchListInputSchema,
      run: deepResearchList,
    }),
    makeJsonCommand({
      name: "wait",
      commandName: "deep-research wait",
      description: "Wait for a deep research task to reach a terminal status",
      schema: DeepResearchWaitInputSchema,
      run: deepResearchWait,
    }),
    makeJsonCommand({
      name: "events",
      commandName: "deep-research events",
      description: "Fetch the detailed event log for a deep research task",
      schema: DeepResearchCheckInputSchema,
      run: deepResearchEvents,
    }),
    makeJsonCommand({
      name: "stream",
      commandName: "deep-research stream",
      description: "Collect provider SSE events for a deep research task",
      schema: DeepResearchCheckInputSchema,
      run: deepResearchStream,
    }),
  ]),
)

export const exaCommands = [
  makeBatchJsonCommand({
    name: "web-search",
    commandName: "web-search",
    description: "Search the web with Exa from JSON input",
    schema: WebSearchInputSchema,
    targetFields: ["query"],
    run: webSearch,
  }),
  makeBatchJsonCommand({
    name: "code-context",
    commandName: "code-context",
    description: "Fetch Exa code context from JSON input",
    schema: CodeContextInputSchema,
    targetFields: ["query"],
    run: codeContext,
  }),
  makeBatchJsonCommand({
    name: "crawl",
    commandName: "crawl",
    description: "Crawl a URL with Exa contents API from JSON input",
    schema: CrawlInputSchema,
    targetFields: ["url"],
    run: crawl,
  }),
  makeBatchJsonCommand({
    name: "company-research",
    commandName: "company-research",
    description: "Research a company with Exa from JSON input",
    schema: CompanyResearchInputSchema,
    targetFields: ["companyName"],
    run: companyResearch,
  }),
  makeBatchJsonCommand({
    name: "linkedin-search",
    commandName: "linkedin-search",
    description: "Search LinkedIn with Exa from JSON input",
    schema: LinkedinSearchInputSchema,
    targetFields: ["query"],
    run: linkedinSearch,
  }),
  deepResearchCommand,
  makeBatchJsonCommand({
    name: "find-similar",
    commandName: "find-similar",
    description: "Find pages similar to a URL from JSON input",
    schema: FindSimilarInputSchema,
    targetFields: ["url"],
    run: findSimilar,
  }),
]
