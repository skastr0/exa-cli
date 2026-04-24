import { Args, Command } from "@effect/cli"
import { HttpClient } from "@effect/platform"
import { Effect, Schema } from "effect"

import { requestJson } from "../core/api"
import { CommandInputError, JsonInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"

const DEFAULT_NUM_RESULTS = 8
const DEFAULT_MAX_CHARACTERS = 2000
const DEFAULT_CONTEXT_MAX_CHARACTERS = 10000
const DEFAULT_CODE_TOKENS = 5000
const DEFAULT_SIMILAR_RESULTS = 10

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
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
  model: Schema.optional(Schema.Literal("exa-research", "exa-research-pro")),
})

export const DeepResearchCheckInputSchema = Schema.Struct({
  taskId: Schema.String,
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
type FindSimilarInput = typeof FindSimilarInputSchema.Type

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
        ids: [input.url],
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
      path: "/research/v0/tasks",
      integration: "exa-cli-deep-research",
      body: {
        model,
        instructions: input.instructions,
        output: { inferSchema: false },
      },
      responseSchema: UnknownRecord,
    })

    return {
      taskId: data && typeof data === "object" && "id" in data ? data.id : undefined,
      model,
      instructions: input.instructions,
      data,
    }
  })

const deepResearchCheck = (input: DeepResearchCheckInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("taskId", input.taskId)

    return yield* requestJson({
      method: "GET",
      path: `/research/v0/tasks/${encodeURIComponent(input.taskId)}`,
      integration: "exa-cli-deep-research",
      responseSchema: UnknownRecord,
    })
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
  Command.make(options.name, { input: jsonInputArg }, ({ input }) =>
    executeJsonCommand(
      options.commandName,
      loadCommandInput(options.schema, input).pipe(Effect.flatMap(options.run)),
    ),
  ).pipe(Command.withDescription(options.description))

const deepResearchCommand = Command.make("deep-research").pipe(
  Command.withDescription("Start and check Exa deep research tasks"),
  Command.withSubcommands([
    makeJsonCommand({
      name: "start",
      commandName: "deep-research start",
      description: "Start a deep research task from JSON input",
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
  ]),
)

export const exaCommands = [
  makeJsonCommand({
    name: "web-search",
    commandName: "web-search",
    description: "Search the web with Exa from JSON input",
    schema: WebSearchInputSchema,
    run: webSearch,
  }),
  makeJsonCommand({
    name: "code-context",
    commandName: "code-context",
    description: "Fetch Exa code context from JSON input",
    schema: CodeContextInputSchema,
    run: codeContext,
  }),
  makeJsonCommand({
    name: "crawl",
    commandName: "crawl",
    description: "Crawl a URL with Exa contents API from JSON input",
    schema: CrawlInputSchema,
    run: crawl,
  }),
  makeJsonCommand({
    name: "company-research",
    commandName: "company-research",
    description: "Research a company with Exa from JSON input",
    schema: CompanyResearchInputSchema,
    run: companyResearch,
  }),
  makeJsonCommand({
    name: "linkedin-search",
    commandName: "linkedin-search",
    description: "Search LinkedIn with Exa from JSON input",
    schema: LinkedinSearchInputSchema,
    run: linkedinSearch,
  }),
  deepResearchCommand,
  makeJsonCommand({
    name: "find-similar",
    commandName: "find-similar",
    description: "Find pages similar to a URL from JSON input",
    schema: FindSimilarInputSchema,
    run: findSimilar,
  }),
]
