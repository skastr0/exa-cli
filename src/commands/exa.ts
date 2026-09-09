import { Args, Command, Options } from "@effect/cli"
import { HttpClient } from "@effect/platform"
import { Effect, Schema } from "effect"

import { applyOutputPolicy, type OutputMode } from "../core/artifacts"
import { executeBatchJsonCommand, runBatchJsonCommand } from "../core/batch"
import { requestJson, requestText } from "../core/api"
import {
  AgentWaitTimeoutError,
  CommandInputError,
  JsonInputError,
  ResearchWaitTimeoutError,
} from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"

const DEFAULT_NUM_RESULTS = 8
const DEFAULT_MAX_CHARACTERS = 2000
const DEFAULT_CODE_TOKENS = 5000
const DEFAULT_SIMILAR_RESULTS = 10
export const DEFAULT_BATCH_CONCURRENCY = 5
const DEFAULT_WAIT_INTERVAL_MS = 2000
const DEFAULT_WAIT_TIMEOUT_MS = 180_000
const DYNAMIC_HIGHLIGHTS_BETA = "dynamic-highlights-2026-08-28"
const AGENT_MAX_EFFORT_BETA = "agent-max-effort-2026-07-27"
const DEEP_SEARCH_TYPES = new Set(["deep-lite", "deep", "deep-reasoning"])
const ENTITY_CATEGORIES = new Set(["company", "people"])

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

const SearchType = Schema.Literal("auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning")
const LivecrawlMode = Schema.Literal("never", "always", "fallback", "preferred")
const SearchCategory = Schema.Literal(
  "company",
  "publication",
  "news",
  "personal site",
  "financial report",
  "people",
  "research paper",
  "pdf",
  "github",
  "tweet",
)
const PageSection = Schema.Literal(
  "header",
  "navigation",
  "banner",
  "body",
  "sidebar",
  "footer",
  "metadata",
)
const SearchTextFilter = Schema.Union(Schema.String, Schema.Array(Schema.String))
const AgentEffort = Schema.Literal("minimal", "low", "medium", "high", "xhigh", "auto", "max")
const AgentDataSourceProvider = Schema.Literal(
  "fiber",
  "financial_datasets",
  "similarweb",
  "baselayer",
  "affiliate",
  "particle",
  "jinko",
  "polymarket",
)
const AnswerModel = Schema.Literal("exa", "exa-pro", "exa-research", "exa-fast")

const TextContentsOptions = Schema.Union(
  Schema.Boolean,
  Schema.Struct({
    maxCharacters: Schema.optional(Schema.Number),
    includeHtmlTags: Schema.optional(Schema.Boolean),
    verbosity: Schema.optional(Schema.Literal("compact", "standard", "full")),
    includeSections: Schema.optional(Schema.Array(PageSection)),
    excludeSections: Schema.optional(Schema.Array(PageSection)),
  }),
)

const HighlightsContentsOptions = Schema.Union(
  Schema.Boolean,
  Schema.Struct({
    query: Schema.optional(Schema.String),
    verbosity: Schema.optional(Schema.Literal("low", "medium", "high")),
    dynamic: Schema.optional(Schema.Boolean),
    maxCharacters: Schema.optional(Schema.Number),
  }),
)

const SummaryContentsOptions = Schema.Struct({
  query: Schema.optional(Schema.String),
  schema: Schema.optional(UnknownRecord),
})

const ExtrasContentsOptions = Schema.Struct({
  links: Schema.optional(Schema.Number),
  imageLinks: Schema.optional(Schema.Number),
  richImageLinks: Schema.optional(Schema.Number),
  richLinks: Schema.optional(Schema.Number),
  codeBlocks: Schema.optional(Schema.Number),
})

const ContextContentsOptions = Schema.Union(
  Schema.Boolean,
  Schema.Struct({
    maxCharacters: Schema.optional(Schema.Number),
  }),
)

export const ContentsOptionsSchema = Schema.Struct({
  text: Schema.optional(TextContentsOptions),
  highlights: Schema.optional(HighlightsContentsOptions),
  summary: Schema.optional(SummaryContentsOptions),
  extras: Schema.optional(ExtrasContentsOptions),
  context: Schema.optional(ContextContentsOptions),
  livecrawl: Schema.optional(LivecrawlMode),
  livecrawlTimeout: Schema.optional(Schema.Number),
  maxAgeHours: Schema.optional(Schema.Number),
  subpages: Schema.optional(Schema.Number),
  subpageTarget: Schema.optional(Schema.Union(Schema.String, Schema.Array(Schema.String))),
})

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
  userLocation: Schema.optional(Schema.String),
  moderation: Schema.optional(Schema.Boolean),
  additionalQueries: Schema.optional(Schema.Array(Schema.String)),
  outputSchema: Schema.optional(UnknownRecord),
  systemPrompt: Schema.optional(Schema.String),
  stream: Schema.optional(Schema.Boolean),
  contents: Schema.optional(ContentsOptionsSchema),
})

export const CodeContextInputSchema = Schema.Struct({
  query: Schema.String,
  tokensNum: Schema.optional(Schema.Union(Schema.Literal("dynamic"), Schema.Number)),
  flags: Schema.optional(Schema.Array(Schema.String)),
})

export const CrawlInputSchema = Schema.Struct({
  url: Schema.String,
  maxCharacters: Schema.optional(Schema.Number),
})

export const ContentsInputSchema = Schema.Struct({
  ids: Schema.optional(Schema.Array(Schema.String)),
  urls: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  text: Schema.optional(TextContentsOptions),
  highlights: Schema.optional(HighlightsContentsOptions),
  summary: Schema.optional(SummaryContentsOptions),
  extras: Schema.optional(ExtrasContentsOptions),
  context: Schema.optional(ContextContentsOptions),
  livecrawl: Schema.optional(LivecrawlMode),
  livecrawlTimeout: Schema.optional(Schema.Number),
  maxAgeHours: Schema.optional(Schema.Number),
  subpages: Schema.optional(Schema.Number),
  subpageTarget: Schema.optional(Schema.Union(Schema.String, Schema.Array(Schema.String))),
  maxCharacters: Schema.optional(Schema.Number),
})

export const AnswerInputSchema = Schema.Struct({
  query: Schema.String,
  text: Schema.optional(Schema.Boolean),
  model: Schema.optional(AnswerModel),
  systemPrompt: Schema.optional(Schema.String),
  userLocation: Schema.optional(Schema.String),
  outputSchema: Schema.optional(UnknownRecord),
  stream: Schema.optional(Schema.Boolean),
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

const AgentInputRows = Schema.Struct({
  data: Schema.optional(Schema.Array(UnknownRecord)),
  exclusion: Schema.optional(Schema.Array(UnknownRecord)),
})

const AgentBudget = Schema.Struct({
  maxCostDollars: Schema.optional(Schema.Number),
})

const AgentDataSource = Schema.Struct({
  provider: AgentDataSourceProvider,
})

export const AgentStartInputSchema = Schema.Struct({
  query: Schema.String,
  systemPrompt: Schema.optional(Schema.String),
  input: Schema.optional(AgentInputRows),
  outputSchema: Schema.optional(UnknownRecord),
  effort: Schema.optional(AgentEffort),
  previousRunId: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  dataSources: Schema.optional(Schema.Array(AgentDataSource)),
  budget: Schema.optional(AgentBudget),
})

export const AgentIdInputSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
})

export const AgentListInputSchema = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})

export const AgentWaitInputSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  intervalMs: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
})

export const AgentEventsInputSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})

export const AgentStreamInputSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  lastEventId: Schema.optional(Schema.String),
})

export const DeepResearchStartInputSchema = Schema.Struct({
  instructions: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  model: Schema.optional(Schema.Literal("exa-research-fast", "exa-research", "exa-research-pro")),
  outputSchema: Schema.optional(UnknownRecord),
  systemPrompt: Schema.optional(Schema.String),
  effort: Schema.optional(AgentEffort),
  input: Schema.optional(AgentInputRows),
  previousRunId: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  dataSources: Schema.optional(Schema.Array(AgentDataSource)),
  budget: Schema.optional(AgentBudget),
})

export const DeepResearchCheckInputSchema = Schema.Struct({
  researchId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
})

export const DeepResearchListInputSchema = AgentListInputSchema

export const DeepResearchWaitInputSchema = Schema.Struct({
  researchId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  intervalMs: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
})

export const DeepResearchEventsInputSchema = Schema.Struct({
  researchId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})

export const DeepResearchStreamInputSchema = Schema.Struct({
  researchId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  lastEventId: Schema.optional(Schema.String),
})

export const FindSimilarInputSchema = Schema.Struct({
  url: Schema.String,
  numResults: Schema.optional(Schema.Number),
  includeDomains: Schema.optional(Schema.Array(Schema.String)),
  excludeDomains: Schema.optional(Schema.Array(Schema.String)),
  startPublishedDate: Schema.optional(Schema.String),
  endPublishedDate: Schema.optional(Schema.String),
  category: Schema.optional(SearchCategory),
  excludeSourceDomain: Schema.optional(Schema.Boolean),
  contents: Schema.optional(ContentsOptionsSchema),
})

type WebSearchInput = typeof WebSearchInputSchema.Type
type CodeContextInput = typeof CodeContextInputSchema.Type
type CrawlInput = typeof CrawlInputSchema.Type
type ContentsInput = typeof ContentsInputSchema.Type
type AnswerInput = typeof AnswerInputSchema.Type
type CompanyResearchInput = typeof CompanyResearchInputSchema.Type
type LinkedinSearchInput = typeof LinkedinSearchInputSchema.Type
type AgentStartInput = typeof AgentStartInputSchema.Type
type AgentIdInput = typeof AgentIdInputSchema.Type
type AgentListInput = typeof AgentListInputSchema.Type
type AgentWaitInput = typeof AgentWaitInputSchema.Type
type AgentEventsInput = typeof AgentEventsInputSchema.Type
type AgentStreamInput = typeof AgentStreamInputSchema.Type
type DeepResearchStartInput = typeof DeepResearchStartInputSchema.Type
type DeepResearchIdInput = typeof DeepResearchCheckInputSchema.Type
type DeepResearchListInput = typeof DeepResearchListInputSchema.Type
type DeepResearchWaitInput = typeof DeepResearchWaitInputSchema.Type
type DeepResearchEventsInput = typeof DeepResearchEventsInputSchema.Type
type DeepResearchStreamInput = typeof DeepResearchStreamInputSchema.Type
type FindSimilarInput = typeof FindSimilarInputSchema.Type
type ContentsOptions = typeof ContentsOptionsSchema.Type

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
  readonly deprecated?: boolean
}

const outputModes = ["inline", "artifact", "auto"] as const

const contentsDomainRules = [
  "Provide exactly one of ids, urls, or url.",
  "Contents options are top-level on /contents; do not nest them under contents.",
  "livecrawl is deprecated; prefer maxAgeHours. Do not send both.",
  "highlights.dynamic and highlights.verbosity send Exa-Beta: dynamic-highlights-2026-08-28.",
]

const searchDomainRules = [
  "Search types are auto, fast, instant, deep-lite, deep, and deep-reasoning. neural is no longer a public type.",
  "Known categories: company, publication, news, personal site, financial report, people. research paper, pdf, github, and tweet are deprecated hints.",
  "company and people do not support startPublishedDate, endPublishedDate, or excludeDomains.",
  "additionalQueries is only valid with deep-lite, deep, or deep-reasoning.",
  "stream requires outputSchema and collects provider SSE into the JSON envelope.",
  "livecrawl and context are deprecated; prefer maxAgeHours, highlights, or text.",
]

export const exaCommandContracts: ReadonlyArray<ExaCommandContract> = [
  {
    command: "web-search",
    description: "Search the web with Exa.",
    schema: WebSearchInputSchema,
    batch: true,
    outputModes,
    domainRules: searchDomainRules,
    examples: [
      { name: "single-search", input: { query: "Effect Schema", numResults: 5 } },
      {
        name: "batch-search",
        input: [{ query: "Effect Schema" }, { query: "Effect CLI" }],
      },
      {
        name: "deep-reasoning",
        input: {
          query: "Compare Exa search types for agent research",
          type: "deep-reasoning",
          outputSchema: {
            type: "object",
            properties: { summary: { type: "string" } },
            required: ["summary"],
          },
        },
      },
    ],
  },
  {
    command: "code-context",
    description: "Fetch Exa code context.",
    schema: CodeContextInputSchema,
    batch: true,
    outputModes,
    domainRules: ["tokensNum may be dynamic or an integer from 50 to 100000."],
    examples: [
      { name: "react-hooks", input: { query: "React useState examples", tokensNum: 5000 } },
      { name: "dynamic-tokens", input: { query: "Effect Schema decodeUnknown", tokensNum: "dynamic" } },
    ],
  },
  {
    command: "contents",
    description: "Fetch page contents for document ids or URLs.",
    schema: ContentsInputSchema,
    batch: true,
    outputModes,
    domainRules: contentsDomainRules,
    examples: [
      { name: "contents-url", input: { url: "https://example.com", text: true } },
      {
        name: "contents-ids",
        input: {
          ids: ["https://example.com"],
          highlights: { query: "API contract" },
          summary: { query: "What does this page describe?" },
        },
      },
    ],
  },
  {
    command: "crawl",
    description: "Fetch page contents for a URL.",
    schema: CrawlInputSchema,
    batch: true,
    outputModes,
    domainRules: ["crawl is a thin /contents wrapper for one URL. Prefer contents for ids, highlights, summary, or subpages."],
    examples: [{ name: "crawl-page", input: { url: "https://example.com", maxCharacters: 3000 } }],
  },
  {
    command: "answer",
    description: "Get a grounded Exa answer with citations.",
    schema: AnswerInputSchema,
    batch: true,
    outputModes,
    examples: [
      { name: "factual-answer", input: { query: "What is the capital of France?" } },
      {
        name: "structured-answer",
        input: {
          query: "Latest SpaceX valuation",
          model: "exa",
          outputSchema: {
            type: "object",
            properties: { valuation: { type: "string" } },
            required: ["valuation"],
          },
        },
      },
    ],
  },
  {
    command: "company-research",
    description: "Search company-focused sources.",
    schema: CompanyResearchInputSchema,
    batch: true,
    outputModes,
    domainRules: ["Sends POST /search with type auto and category company."],
    examples: [{ name: "company", input: { companyName: "Acme", numResults: 5 } }],
  },
  {
    command: "linkedin-search",
    description: "Search people or company profiles.",
    schema: LinkedinSearchInputSchema,
    batch: true,
    outputModes,
    domainRules: [
      "profiles uses category people.",
      "companies uses category company.",
      "all scopes includeDomains to linkedin.com.",
    ],
    examples: [{ name: "profiles", input: { query: "Jane Doe", searchType: "profiles" } }],
  },
  {
    command: "find-similar",
    description: "Find pages similar to a URL.",
    schema: FindSimilarInputSchema,
    batch: true,
    outputModes,
    deprecated: true,
    domainRules: ["Exa marks POST /findSimilar deprecated. Prefer web-search with a query describing the source."],
    examples: [{ name: "similar", input: { url: "https://example.com/article" } }],
  },
  {
    command: "agent start",
    description: "Start an asynchronous Exa Agent run.",
    schema: AgentStartInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["effort max sends Exa-Beta: agent-max-effort-2026-07-27."],
    examples: [{ name: "agent-start", input: { query: "Research the Exa API", effort: "medium" } }],
  },
  {
    command: "agent run",
    description: "Alias for starting an asynchronous Exa Agent run.",
    schema: AgentStartInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    examples: [{ name: "agent-run", input: { query: "Research the Exa API" } }],
  },
  {
    command: "agent check",
    description: "Inspect an Agent run by id.",
    schema: AgentIdInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either id or runId."],
    examples: [{ name: "agent-check", input: { id: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "agent inspect",
    description: "Alias for inspecting an Agent run by id.",
    schema: AgentIdInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either id or runId."],
    examples: [{ name: "agent-inspect", input: { runId: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "agent list",
    description: "List Agent runs.",
    schema: AgentListInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    examples: [{ name: "agent-list", input: { limit: 10 } }],
  },
  {
    command: "agent wait",
    description: "Poll an Agent run until it reaches a terminal status.",
    schema: AgentWaitInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either id or runId."],
    examples: [
      {
        name: "agent-wait",
        input: { id: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8", intervalMs: 2000, timeoutMs: 180000 },
      },
    ],
  },
  {
    command: "agent events",
    description: "Fetch stored Agent run events.",
    schema: AgentEventsInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either id or runId."],
    examples: [{ name: "agent-events", input: { id: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "agent stream",
    description: "Collect Agent run events as provider SSE.",
    schema: AgentStreamInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either id or runId. Replays GET /agent/runs/{id}/events with Accept: text/event-stream."],
    examples: [{ name: "agent-stream", input: { id: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "agent cancel",
    description: "Cancel a queued or running Agent run.",
    schema: AgentIdInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either id or runId."],
    examples: [{ name: "agent-cancel", input: { id: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "agent stop",
    description: "Stop a max-effort Agent run early and keep results so far.",
    schema: AgentIdInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: [
      "Provide either id or runId.",
      "Currently documented only for effort max; sends Exa-Beta: agent-max-effort-2026-07-27.",
    ],
    examples: [{ name: "agent-stop", input: { id: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "agent delete",
    description: "Delete a stored Agent run.",
    schema: AgentIdInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    domainRules: ["Provide either id or runId."],
    examples: [{ name: "agent-delete", input: { id: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "deep-research start",
    description: "Start an asynchronous Exa research task.",
    schema: DeepResearchStartInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    domainRules: [
      "Aliases agent start. /research/v1 was retired on 2026-05-01.",
      "Provide instructions or query.",
      "Do not send model; use effort.",
    ],
    examples: [{ name: "start", input: { instructions: "Research the Exa API" } }],
  },
  {
    command: "deep-research run",
    description: "Alias for starting an asynchronous Exa research task.",
    schema: DeepResearchStartInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    examples: [{ name: "run", input: { instructions: "Research the Exa API" } }],
  },
  {
    command: "deep-research check",
    description: "Inspect a research task by id.",
    schema: DeepResearchCheckInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    domainRules: ["Provide researchId, taskId, id, or runId."],
    examples: [{ name: "check", input: { researchId: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "deep-research inspect",
    description: "Alias for inspecting a research task by id.",
    schema: DeepResearchCheckInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    domainRules: ["Provide researchId, taskId, id, or runId."],
    examples: [{ name: "inspect", input: { researchId: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "deep-research list",
    description: "List research tasks.",
    schema: DeepResearchListInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    examples: [{ name: "list", input: { limit: 10 } }],
  },
  {
    command: "deep-research wait",
    description: "Poll a research task until it reaches a terminal status.",
    schema: DeepResearchWaitInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    domainRules: ["Provide researchId, taskId, id, or runId."],
    examples: [
      {
        name: "wait",
        input: { researchId: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8", intervalMs: 2000, timeoutMs: 180000 },
      },
    ],
  },
  {
    command: "deep-research events",
    description: "Fetch research event log data.",
    schema: DeepResearchEventsInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    domainRules: ["Provide researchId, taskId, id, or runId."],
    examples: [{ name: "events", input: { researchId: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "deep-research stream",
    description: "Collect provider SSE updates for a research task.",
    schema: DeepResearchStreamInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    domainRules: ["Provide researchId, taskId, id, or runId."],
    examples: [{ name: "stream", input: { researchId: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
  {
    command: "deep-research cancel",
    description: "Cancel a queued or running research task.",
    schema: DeepResearchCheckInputSchema,
    batch: false,
    outputModes,
    lifecycle: true,
    deprecated: true,
    domainRules: ["Provide researchId, taskId, id, or runId. Aliases agent cancel."],
    examples: [{ name: "cancel", input: { researchId: "agent_run_01j7x9v0m2n4p6q8r0s2t4v6w8" } }],
  },
]

const asTextArray = (value: string | ReadonlyArray<string> | undefined) =>
  typeof value === "string" ? [value] : value

const omitUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(omitUndefined)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, omitUndefined(nested)]),
    )
  }

  return value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const highlightsNeedBeta = (highlights: unknown) => {
  if (!isRecord(highlights)) {
    return false
  }

  return highlights.dynamic === true || highlights.verbosity !== undefined
}

const betaHeaders = (...tokens: Array<string | undefined>) => {
  const unique = [...new Set(tokens.filter((token): token is string => Boolean(token)))]
  return unique.length > 0 ? { "Exa-Beta": unique.join(",") } : undefined
}

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

const validateIntegerRange = (field: string, value: number | undefined, min: number, max: number) =>
  value !== undefined && (!Number.isInteger(value) || value < min || value > max)
    ? Effect.fail(
        new CommandInputError({
          field,
          message: `${field} must be an integer between ${min} and ${max}`,
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

const validateUserLocation = (value: string | undefined) =>
  value !== undefined && !/^[A-Za-z]{2}$/.test(value)
    ? Effect.fail(
        new CommandInputError({
          field: "userLocation",
          message: "userLocation must be a two-letter ISO country code",
        }),
      )
    : Effect.void

const validateEntityCategoryFilters = (input: {
  readonly category?: string | undefined
  readonly startPublishedDate?: string | undefined
  readonly endPublishedDate?: string | undefined
  readonly excludeDomains?: ReadonlyArray<string> | undefined
}) => {
  if (!input.category || !ENTITY_CATEGORIES.has(input.category)) {
    return Effect.void
  }

  if (input.startPublishedDate || input.endPublishedDate || input.excludeDomains) {
    return Effect.fail(
      new CommandInputError({
        field: "category",
        message: `${input.category} does not support startPublishedDate, endPublishedDate, or excludeDomains`,
      }),
    )
  }

  return Effect.void
}

const validateContentsOptions = (contents: ContentsOptions | undefined, prefix = "") =>
  Effect.gen(function* () {
    if (!contents) {
      return
    }

    const field = (name: string) => (prefix.length > 0 ? `${prefix}${name}` : name)
    const text = contents.text
    if (text && typeof text === "object") {
      yield* validateIntegerRange(field("text.maxCharacters"), text.maxCharacters, 1, 10000)
    }

    const highlights = contents.highlights
    if (highlights && typeof highlights === "object") {
      yield* validateIntegerRange(field("highlights.maxCharacters"), highlights.maxCharacters, 1, 10000)
      if (highlights.dynamic === true && highlights.maxCharacters !== undefined) {
        yield* Effect.fail(
          new CommandInputError({
            field: field("highlights.dynamic"),
            message: "highlights.dynamic is not compatible with highlights.maxCharacters",
          }),
        )
      }
    }

    yield* validateIntegerRange(field("livecrawlTimeout"), contents.livecrawlTimeout, 1, 90000)
    yield* validateIntegerRange(field("maxAgeHours"), contents.maxAgeHours, -1, 720)
    yield* validateIntegerRange(field("subpages"), contents.subpages, 0, 100)
    if (contents.livecrawl !== undefined && contents.maxAgeHours !== undefined) {
      yield* Effect.fail(
        new CommandInputError({
          field: field("livecrawl"),
          message: "Do not send livecrawl and maxAgeHours together; prefer maxAgeHours",
        }),
      )
    }
  })

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

const firstNonEmpty = (...values: Array<string | undefined>) => {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value
    }
  }

  return undefined
}

const resolveAgentRunId = (input: {
  readonly id?: string | undefined
  readonly runId?: string | undefined
  readonly researchId?: string | undefined
  readonly taskId?: string | undefined
}) =>
  Effect.gen(function* () {
    const runId = firstNonEmpty(input.id, input.runId, input.researchId, input.taskId)

    if (!runId) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "id",
          message: "id, runId, researchId, or taskId must not be empty",
        }),
      )
    }

    return runId
  })

const extractStatus = (data: unknown) =>
  data && typeof data === "object" && "status" in data && typeof data.status === "string"
    ? data.status
    : undefined

const extractId = (data: unknown) =>
  data && typeof data === "object" && "id" in data && typeof data.id === "string" ? data.id : undefined

const isTerminalRunStatus = (status: string | undefined) =>
  status === "completed" || status === "canceled" || status === "cancelled" || status === "failed"

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

const resolveSearchContents = (input: WebSearchInput): ContentsOptions => {
  const contents: ContentsOptions = {
    ...(input.contents ?? {}),
    ...(input.livecrawl !== undefined && input.contents?.livecrawl === undefined
      ? { livecrawl: input.livecrawl }
      : {}),
    ...(input.contextMaxCharacters !== undefined && input.contents?.context === undefined
      ? { context: { maxCharacters: input.contextMaxCharacters } }
      : {}),
  }

  const hasContents =
    contents.text !== undefined ||
    contents.highlights !== undefined ||
    contents.summary !== undefined ||
    contents.extras !== undefined ||
    contents.context !== undefined ||
    contents.livecrawl !== undefined ||
    contents.livecrawlTimeout !== undefined ||
    contents.maxAgeHours !== undefined ||
    contents.subpages !== undefined ||
    contents.subpageTarget !== undefined

  if (!hasContents) {
    return { text: true }
  }

  if (input.contents === undefined && contents.text === undefined) {
    return { ...contents, text: true }
  }

  return contents
}

const collectedSse = (runId: string, text: string) => {
  const events = parseSse(text)
  return {
    runId,
    researchId: runId,
    event_count: events.length,
    events,
    ...(events.length === 0 && text.trim().length > 0 ? { raw: text } : {}),
  }
}

const withHeaders = (...tokens: Array<string | undefined>) => {
  const headers = betaHeaders(...tokens)
  return headers ? { headers } : {}
}

const webSearch = (input: WebSearchInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("query", input.query)
    yield* validateIntegerRange("numResults", input.numResults, 1, 100)
    yield* validateIntegerRange("contextMaxCharacters", input.contextMaxCharacters, 1, 10000)
    yield* validateUserLocation(input.userLocation)
    yield* validateEntityCategoryFilters(input)
    const contents = resolveSearchContents(input)
    yield* validateContentsOptions(contents, "contents.")

    const type = input.type ?? "auto"
    if (input.additionalQueries && !DEEP_SEARCH_TYPES.has(type)) {
      yield* Effect.fail(
        new CommandInputError({
          field: "additionalQueries",
          message: "additionalQueries is only valid with type deep-lite, deep, or deep-reasoning",
        }),
      )
    }

    if (input.additionalQueries && (input.additionalQueries.length < 1 || input.additionalQueries.length > 10)) {
      yield* Effect.fail(
        new CommandInputError({
          field: "additionalQueries",
          message: "additionalQueries must contain between 1 and 10 queries",
        }),
      )
    }

    if (input.stream === true && input.outputSchema === undefined) {
      yield* Effect.fail(
        new CommandInputError({
          field: "stream",
          message: "stream requires outputSchema",
        }),
      )
    }

    const body = omitUndefined({
      query: input.query,
      type,
      numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
      contents,
      category: input.category,
      includeDomains: input.includeDomains,
      excludeDomains: input.excludeDomains,
      startPublishedDate: input.startPublishedDate,
      endPublishedDate: input.endPublishedDate,
      includeText: asTextArray(input.includeText),
      excludeText: asTextArray(input.excludeText),
      userLocation: input.userLocation,
      moderation: input.moderation,
      additionalQueries: input.additionalQueries,
      outputSchema: input.outputSchema,
      systemPrompt: input.systemPrompt,
      stream: input.stream === true ? true : undefined,
    })

    const headers = betaHeaders(highlightsNeedBeta(contents.highlights) ? DYNAMIC_HIGHLIGHTS_BETA : undefined)

    if (input.stream === true) {
      const text = yield* requestText({
        method: "POST",
        path: "/search",
        integration: "exa-cli-web-search",
        body,
        headers: {
          accept: "text/event-stream",
          ...headers,
        },
      })
      const events = parseSse(text)
      return {
        event_count: events.length,
        events,
        ...(events.length === 0 && text.trim().length > 0 ? { raw: text } : {}),
      }
    }

    const data = yield* requestJson({
      method: "POST",
      path: "/search",
      integration: "exa-cli-web-search",
      body,
      ...withHeaders(highlightsNeedBeta(contents.highlights) ? DYNAMIC_HIGHLIGHTS_BETA : undefined),
      responseSchema: UnknownRecord,
    })

    return {
      context: isRecord(data) && "context" in data ? data.context : undefined,
      output: isRecord(data) && "output" in data ? data.output : undefined,
      data,
    }
  })

const codeContext = (input: CodeContextInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("query", input.query)
    if (input.query.length > 2000) {
      yield* Effect.fail(
        new CommandInputError({
          field: "query",
          message: "query must be at most 2000 characters",
        }),
      )
    }

    const tokensNum = input.tokensNum ?? DEFAULT_CODE_TOKENS
    if (typeof tokensNum === "number") {
      yield* validateIntegerRange("tokensNum", tokensNum, 50, 100000)
    }

    const data = yield* requestJson({
      method: "POST",
      path: "/context",
      integration: "exa-cli-code-context",
      body: omitUndefined({
        query: input.query,
        tokensNum,
        flags: input.flags,
      }),
      responseSchema: UnknownRecord,
    })

    return {
      context: isRecord(data) && "response" in data ? data.response : undefined,
      data,
    }
  })

const contentsRequest = (input: ContentsInput) =>
  Effect.gen(function* () {
    const selected = [input.ids, input.urls, input.url].filter((value) => value !== undefined)
    if (selected.length !== 1) {
      yield* Effect.fail(
        new CommandInputError({
          field: "ids",
          message: "Provide exactly one of ids, urls, or url",
        }),
      )
    }

    if (input.ids) {
      if (input.ids.length < 1 || input.ids.length > 100) {
        yield* Effect.fail(
          new CommandInputError({
            field: "ids",
            message: "ids must contain between 1 and 100 values",
          }),
        )
      }
      yield* Effect.forEach(input.ids, (id) => validateNonEmpty("ids", id), { concurrency: 1, discard: true })
    }

    if (input.urls) {
      if (input.urls.length < 1 || input.urls.length > 100) {
        yield* Effect.fail(
          new CommandInputError({
            field: "urls",
            message: "urls must contain between 1 and 100 values",
          }),
        )
      }
      yield* Effect.forEach(input.urls, (url) => validateUrl("urls", url), { concurrency: 1, discard: true })
    }

    if (input.url) {
      yield* validateNonEmpty("url", input.url)
      yield* validateUrl("url", input.url)
    }

    yield* validatePositiveInteger("maxCharacters", input.maxCharacters)
    const contents: ContentsOptions = {
      text: input.text ?? (input.maxCharacters !== undefined ? { maxCharacters: input.maxCharacters } : undefined),
      highlights: input.highlights,
      summary: input.summary,
      extras: input.extras,
      context: input.context,
      livecrawl: input.livecrawl,
      livecrawlTimeout: input.livecrawlTimeout,
      maxAgeHours: input.maxAgeHours,
      subpages: input.subpages,
      subpageTarget: input.subpageTarget,
    }

    const hasContents =
      contents.text !== undefined ||
      contents.highlights !== undefined ||
      contents.summary !== undefined ||
      contents.extras !== undefined ||
      contents.context !== undefined ||
      contents.livecrawl !== undefined ||
      contents.livecrawlTimeout !== undefined ||
      contents.maxAgeHours !== undefined ||
      contents.subpages !== undefined ||
      contents.subpageTarget !== undefined

    const resolvedContents = hasContents ? contents : { ...contents, text: true as const }

    yield* validateContentsOptions(resolvedContents)

    return yield* requestJson({
      method: "POST",
      path: "/contents",
      integration: "exa-cli-contents",
      body: omitUndefined({
        ids: input.ids,
        urls: input.urls ?? (input.url ? [input.url] : undefined),
        ...resolvedContents,
      }),
      ...withHeaders(highlightsNeedBeta(resolvedContents.highlights) ? DYNAMIC_HIGHLIGHTS_BETA : undefined),
      responseSchema: UnknownRecord,
    })
  })

const crawl = (input: CrawlInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("url", input.url)
    yield* validateUrl("url", input.url)
    yield* validateIntegerRange("maxCharacters", input.maxCharacters, 1, 10000)

    return yield* requestJson({
      method: "POST",
      path: "/contents",
      integration: "exa-cli-crawling",
      body: {
        urls: [input.url],
        text: { maxCharacters: input.maxCharacters ?? DEFAULT_MAX_CHARACTERS },
        maxAgeHours: 0,
      },
      responseSchema: UnknownRecord,
    })
  })

const answer = (input: AnswerInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("query", input.query)
    yield* validateUserLocation(input.userLocation)

    const body = omitUndefined({
      query: input.query,
      text: input.text,
      model: input.model,
      systemPrompt: input.systemPrompt,
      userLocation: input.userLocation,
      outputSchema: input.outputSchema,
      stream: input.stream === true ? true : undefined,
    })

    if (input.stream === true) {
      const text = yield* requestText({
        method: "POST",
        path: "/answer",
        integration: "exa-cli-answer",
        body,
        headers: { accept: "text/event-stream" },
      })
      const events = parseSse(text)
      return {
        event_count: events.length,
        events,
        ...(events.length === 0 && text.trim().length > 0 ? { raw: text } : {}),
      }
    }

    const data = yield* requestJson({
      method: "POST",
      path: "/answer",
      integration: "exa-cli-answer",
      body,
      responseSchema: UnknownRecord,
    })

    return {
      answer: isRecord(data) && "answer" in data ? data.answer : undefined,
      data,
    }
  })

const companyResearch = (input: CompanyResearchInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("companyName", input.companyName)
    yield* validateIntegerRange("numResults", input.numResults, 1, 100)

    return yield* requestJson({
      method: "POST",
      path: "/search",
      integration: "exa-cli-company-research",
      body: {
        query: input.companyName,
        type: "auto",
        category: "company",
        numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
        contents: {
          text: { maxCharacters: DEFAULT_MAX_CHARACTERS },
        },
      },
      responseSchema: UnknownRecord,
    })
  })

const linkedinSearch = (input: LinkedinSearchInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("query", input.query)
    yield* validateIntegerRange("numResults", input.numResults, 1, 100)

    const searchType = input.searchType ?? "all"
    const body =
      searchType === "profiles"
        ? {
            query: input.query,
            type: "auto",
            category: "people",
            numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
            contents: { text: { maxCharacters: DEFAULT_MAX_CHARACTERS } },
          }
        : searchType === "companies"
          ? {
              query: input.query,
              type: "auto",
              category: "company",
              numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
              contents: { text: { maxCharacters: DEFAULT_MAX_CHARACTERS } },
            }
          : {
              query: `${input.query} LinkedIn`,
              type: "auto",
              numResults: input.numResults ?? DEFAULT_NUM_RESULTS,
              contents: { text: { maxCharacters: DEFAULT_MAX_CHARACTERS } },
              includeDomains: ["linkedin.com"],
            }

    return yield* requestJson({
      method: "POST",
      path: "/search",
      integration: "exa-cli-linkedin-search",
      body,
      responseSchema: UnknownRecord,
    })
  })

const agentStart = (input: AgentStartInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("query", input.query)
    if (input.budget?.maxCostDollars !== undefined) {
      yield* validatePositiveNumber("budget.maxCostDollars", input.budget.maxCostDollars)
      if (input.budget.maxCostDollars < 1 || input.budget.maxCostDollars > 100) {
        yield* Effect.fail(
          new CommandInputError({
            field: "budget.maxCostDollars",
            message: "budget.maxCostDollars must be between 1 and 100",
          }),
        )
      }
    }

    const effort = input.effort ?? "auto"
    const data = yield* requestJson({
      method: "POST",
      path: "/agent/runs",
      integration: "exa-cli-agent",
      body: omitUndefined({
        query: input.query,
        systemPrompt: input.systemPrompt,
        input: input.input,
        outputSchema: input.outputSchema,
        effort,
        previousRunId: input.previousRunId,
        metadata: input.metadata,
        dataSources: input.dataSources,
        budget: input.budget,
      }),
      ...withHeaders(effort === "max" ? AGENT_MAX_EFFORT_BETA : undefined),
      responseSchema: UnknownRecord,
    })

    const runId = extractId(data)
    return {
      runId,
      researchId: runId,
      status: extractStatus(data),
      data,
    }
  })

const agentCheck = (input: AgentIdInput) =>
  Effect.gen(function* () {
    const runId = yield* resolveAgentRunId(input)
    return yield* requestJson({
      method: "GET",
      path: `/agent/runs/${encodeURIComponent(runId)}`,
      integration: "exa-cli-agent",
      responseSchema: UnknownRecord,
    })
  })

const agentList = (input: AgentListInput) =>
  Effect.gen(function* () {
    yield* validateIntegerRange("limit", input.limit, 1, 100)

    return yield* requestJson({
      method: "GET",
      path: appendQuery("/agent/runs", {
        cursor: input.cursor,
        limit: input.limit,
      }),
      integration: "exa-cli-agent",
      responseSchema: UnknownRecord,
    })
  })

const agentEvents = (input: AgentEventsInput) =>
  Effect.gen(function* () {
    const runId = yield* resolveAgentRunId(input)
    yield* validateIntegerRange("limit", input.limit, 1, 100)

    return yield* requestJson({
      method: "GET",
      path: appendQuery(`/agent/runs/${encodeURIComponent(runId)}/events`, {
        cursor: input.cursor,
        limit: input.limit,
      }),
      integration: "exa-cli-agent",
      responseSchema: UnknownRecord,
    })
  })

const agentStream = (input: AgentStreamInput) =>
  Effect.gen(function* () {
    const runId = yield* resolveAgentRunId(input)
    const text = yield* requestText({
      method: "GET",
      path: `/agent/runs/${encodeURIComponent(runId)}/events`,
      integration: "exa-cli-agent",
      headers: {
        accept: "text/event-stream",
        ...(input.lastEventId ? { "Last-Event-ID": input.lastEventId } : {}),
      },
    })

    return collectedSse(runId, text)
  })

const agentCancel = (input: AgentIdInput) =>
  Effect.gen(function* () {
    const runId = yield* resolveAgentRunId(input)
    return yield* requestJson({
      method: "POST",
      path: `/agent/runs/${encodeURIComponent(runId)}/cancel`,
      integration: "exa-cli-agent",
      responseSchema: UnknownRecord,
    })
  })

const agentStop = (input: AgentIdInput) =>
  Effect.gen(function* () {
    const runId = yield* resolveAgentRunId(input)
    return yield* requestJson({
      method: "POST",
      path: `/agent/runs/${encodeURIComponent(runId)}/stop`,
      integration: "exa-cli-agent",
      ...withHeaders(AGENT_MAX_EFFORT_BETA),
      responseSchema: UnknownRecord,
    })
  })

const agentDelete = (input: AgentIdInput) =>
  Effect.gen(function* () {
    const runId = yield* resolveAgentRunId(input)
    return yield* requestJson({
      method: "DELETE",
      path: `/agent/runs/${encodeURIComponent(runId)}`,
      integration: "exa-cli-agent",
      responseSchema: UnknownRecord,
    })
  })

const waitForRun = (options: {
  readonly runId: string
  readonly intervalMs: number
  readonly timeoutMs: number
  readonly timeoutError: (lastStatus: string | undefined) => AgentWaitTimeoutError | ResearchWaitTimeoutError
}) =>
  Effect.gen(function* () {
    const startedAt = Date.now()
    let latest: unknown
    let lastStatus: string | undefined

    while (Date.now() - startedAt <= options.timeoutMs) {
      latest = yield* requestJson({
        method: "GET",
        path: `/agent/runs/${encodeURIComponent(options.runId)}`,
        integration: "exa-cli-agent",
        responseSchema: UnknownRecord,
      })
      lastStatus = extractStatus(latest)

      if (isTerminalRunStatus(lastStatus)) {
        return {
          runId: options.runId,
          researchId: options.runId,
          status: lastStatus,
          elapsed_ms: Date.now() - startedAt,
          data: latest,
        }
      }

      yield* Effect.sleep(options.intervalMs)
    }

    return yield* Effect.fail(options.timeoutError(lastStatus))
  })

const agentWait = (input: AgentWaitInput) =>
  Effect.gen(function* () {
    const runId = yield* resolveAgentRunId(input)
    yield* validatePositiveInteger("intervalMs", input.intervalMs)
    yield* validatePositiveInteger("timeoutMs", input.timeoutMs)
    yield* validatePositiveNumber("timeoutMs", input.timeoutMs)

    const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    return yield* waitForRun({
      runId,
      intervalMs: input.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
      timeoutMs,
      timeoutError: (lastStatus) =>
        new AgentWaitTimeoutError({
          runId,
          timeoutMs,
          lastStatus,
          message: `Timed out waiting for agent run ${runId}`,
        }),
    })
  })

const deepResearchStart = (input: DeepResearchStartInput) =>
  Effect.gen(function* () {
    if (input.model !== undefined) {
      yield* Effect.fail(
        new CommandInputError({
          field: "model",
          message:
            "The retired /research/v1 model field is not sent. Use effort on agent start, or omit model.",
        }),
      )
    }

    const query = firstNonEmpty(input.query, input.instructions)
    if (!query) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "instructions",
          message: "instructions or query must not be empty",
        }),
      )
    }

    return yield* agentStart({
      query,
      systemPrompt: input.systemPrompt,
      input: input.input,
      outputSchema: input.outputSchema,
      effort: input.effort,
      previousRunId: input.previousRunId,
      metadata: input.metadata,
      dataSources: input.dataSources,
      budget: input.budget,
    })
  })

const deepResearchWait = (input: DeepResearchWaitInput) =>
  Effect.gen(function* () {
    const runId = yield* resolveAgentRunId(input)
    yield* validatePositiveInteger("intervalMs", input.intervalMs)
    yield* validatePositiveInteger("timeoutMs", input.timeoutMs)
    yield* validatePositiveNumber("timeoutMs", input.timeoutMs)

    const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    return yield* waitForRun({
      runId,
      intervalMs: input.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS,
      timeoutMs,
      timeoutError: (lastStatus) =>
        new ResearchWaitTimeoutError({
          researchId: runId,
          timeoutMs,
          lastStatus,
          message: `Timed out waiting for research task ${runId}`,
        }),
    })
  })

const deepResearchStream = (input: DeepResearchStreamInput) => agentStream(input)

const findSimilar = (input: FindSimilarInput) =>
  Effect.gen(function* () {
    yield* validateNonEmpty("url", input.url)
    yield* validateUrl("url", input.url)
    yield* validateIntegerRange("numResults", input.numResults, 1, 100)
    yield* validateEntityCategoryFilters(input)
    yield* validateContentsOptions(input.contents, "contents.")

    const contents = input.contents ?? { text: true }

    return yield* requestJson({
      method: "POST",
      path: "/findSimilar",
      integration: "exa-cli-find-similar",
      body: omitUndefined({
        url: input.url,
        numResults: input.numResults ?? DEFAULT_SIMILAR_RESULTS,
        includeDomains: input.includeDomains,
        excludeDomains: input.excludeDomains,
        startPublishedDate: input.startPublishedDate,
        endPublishedDate: input.endPublishedDate,
        category: input.category,
        excludeSourceDomain: input.excludeSourceDomain,
        contents,
      }),
      ...withHeaders(highlightsNeedBeta(contents.highlights) ? DYNAMIC_HIGHLIGHTS_BETA : undefined),
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

const agentCommand = Command.make("agent").pipe(
  Command.withDescription("Manage Exa Agent runs"),
  Command.withSubcommands([
    makeJsonCommand({
      name: "start",
      commandName: "agent start",
      description: "Start an Agent run from JSON input",
      schema: AgentStartInputSchema,
      run: agentStart,
    }),
    makeJsonCommand({
      name: "run",
      commandName: "agent run",
      description: "Alias for starting an Agent run from JSON input",
      schema: AgentStartInputSchema,
      run: agentStart,
    }),
    makeJsonCommand({
      name: "check",
      commandName: "agent check",
      description: "Check an Agent run from JSON input",
      schema: AgentIdInputSchema,
      run: agentCheck,
    }),
    makeJsonCommand({
      name: "inspect",
      commandName: "agent inspect",
      description: "Alias for checking an Agent run from JSON input",
      schema: AgentIdInputSchema,
      run: agentCheck,
    }),
    makeJsonCommand({
      name: "list",
      commandName: "agent list",
      description: "List Agent runs from JSON input",
      schema: AgentListInputSchema,
      run: agentList,
    }),
    makeJsonCommand({
      name: "wait",
      commandName: "agent wait",
      description: "Wait for an Agent run to reach a terminal status",
      schema: AgentWaitInputSchema,
      run: agentWait,
    }),
    makeJsonCommand({
      name: "events",
      commandName: "agent events",
      description: "Fetch stored events for an Agent run",
      schema: AgentEventsInputSchema,
      run: agentEvents,
    }),
    makeJsonCommand({
      name: "stream",
      commandName: "agent stream",
      description: "Collect provider SSE events for an Agent run",
      schema: AgentStreamInputSchema,
      run: agentStream,
    }),
    makeJsonCommand({
      name: "cancel",
      commandName: "agent cancel",
      description: "Cancel a queued or running Agent run",
      schema: AgentIdInputSchema,
      run: agentCancel,
    }),
    makeJsonCommand({
      name: "stop",
      commandName: "agent stop",
      description: "Stop a max-effort Agent run early",
      schema: AgentIdInputSchema,
      run: agentStop,
    }),
    makeJsonCommand({
      name: "delete",
      commandName: "agent delete",
      description: "Delete a stored Agent run",
      schema: AgentIdInputSchema,
      run: agentDelete,
    }),
  ]),
)

const deepResearchCommand = Command.make("deep-research").pipe(
  Command.withDescription("Manage Exa deep research tasks via Agent runs"),
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
      run: agentCheck,
    }),
    makeJsonCommand({
      name: "inspect",
      commandName: "deep-research inspect",
      description: "Alias for checking a deep research task from JSON input",
      schema: DeepResearchCheckInputSchema,
      run: agentCheck,
    }),
    makeJsonCommand({
      name: "list",
      commandName: "deep-research list",
      description: "List deep research tasks from JSON input",
      schema: DeepResearchListInputSchema,
      run: agentList,
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
      schema: DeepResearchEventsInputSchema,
      run: agentEvents,
    }),
    makeJsonCommand({
      name: "stream",
      commandName: "deep-research stream",
      description: "Collect provider SSE events for a deep research task",
      schema: DeepResearchStreamInputSchema,
      run: deepResearchStream,
    }),
    makeJsonCommand({
      name: "cancel",
      commandName: "deep-research cancel",
      description: "Cancel a queued or running deep research task",
      schema: DeepResearchCheckInputSchema,
      run: agentCancel,
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
    name: "contents",
    commandName: "contents",
    description: "Fetch Exa contents for ids or URLs from JSON input",
    schema: ContentsInputSchema,
    targetFields: ["url"],
    run: contentsRequest,
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
    name: "answer",
    commandName: "answer",
    description: "Get a grounded Exa answer from JSON input",
    schema: AnswerInputSchema,
    targetFields: ["query"],
    run: answer,
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
  agentCommand,
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
