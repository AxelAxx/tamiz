/**
 * Rule-based task classifier (spec 002 US4, FR-002, FR-008, research R-07,
 * data-model section 3.3).
 *
 * - **Type**: the text of every `system` message plus the **last** `user` message,
 *   lower-cased and accent-stripped, is searched for the cues of {@link CUES} in the
 *   order of {@link TYPE_PRECEDENCE}; the first type with a hit wins, `chat` otherwise.
 * - **Size**: {@link estimateTokens} over the content of **all** messages, against
 *   {@link SIZE_THRESHOLDS} (inclusive upper bounds).
 *
 * Pure and deterministic: no clock, no randomness, no I/O. A learned classifier may
 * replace `classify` later behind the same signature.
 */
import {
  contentOf,
  type InferenceRequest,
  type Message,
  type ToolDefinition,
} from "./inference-request.js";
import { inspectedTexts } from "./inspected-text.js";
import type { Inspection } from "./sensitivity.js";

export const TASK_TYPES = [
  "chat",
  "summarize",
  "extract",
  "classify",
  "code",
  "translate",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_SIZES = ["short", "medium", "long"] as const;
export type TaskSize = (typeof TASK_SIZES)[number];

/** Estimated input tokens: `short` ≤ 512 < `medium` ≤ 4096 < `long`. */
export const SIZE_THRESHOLDS = { short: 512, medium: 4096 } as const;

/** First type with a matching cue wins; no match means `chat`. */
export const TYPE_PRECEDENCE = ["code", "translate", "extract", "classify", "summarize"] as const;
type CuedTaskType = (typeof TYPE_PRECEDENCE)[number];

/**
 * Bilingual (English and Spanish) cues, lower-case and without accents, the table of
 * research R-07. A cue that starts or ends with a letter or digit only matches at a word
 * boundary there; the fenced-block cue matches anywhere.
 */
export const CUES = {
  code: [
    "```",
    "code",
    "codigo",
    "function",
    "funcion",
    "class",
    "clase",
    "bug",
    "stack trace",
    "refactor",
    "refactoriza",
    "implement",
    "implementa",
    "compile",
    "compila",
    "unit test",
    "test unitario",
    "regex",
    "script",
    "sql",
    "typescript",
    "javascript",
    "python",
    "java",
  ],
  translate: [
    "translate",
    "translation",
    "traduce",
    "traducir",
    "traduccion",
    "into english",
    "into spanish",
    "al ingles",
    "al espanol",
    "al castellano",
    "al frances",
    "al aleman",
  ],
  extract: [
    "extract",
    "extrae",
    "extraer",
    "extraccion",
    "as json",
    "en json",
    "in json",
    "fields",
    "campos",
    "parse",
    "parsea",
    "list all",
    "lista todos",
    "lista todas",
  ],
  classify: [
    "classify",
    "classification",
    "clasifica",
    "clasificar",
    "clasificacion",
    "categorize",
    "categoria",
    "category",
    "sentiment",
    "sentimiento",
    "label",
    "etiqueta",
    "spam",
  ],
  summarize: [
    "summarize",
    "summarise",
    "summary",
    "resume",
    "resumen",
    "resumir",
    "tl;dr",
    "key points",
    "puntos clave",
    "sintesis",
  ],
} as const satisfies Record<CuedTaskType, ReadonlyArray<string>>;

export interface Classification {
  readonly taskType: TaskType;
  readonly size: TaskSize;
  readonly estimatedInputTokens: number;
}

/** What the routing decision receives: the request, its classification and inspection. */
export type ClassifiedRequest = InferenceRequest &
  Classification & { readonly inspection: Inspection };

const WORD_CHAR = /[a-z0-9]/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cuePattern(cue: string): RegExp {
  const start = WORD_CHAR.test(cue.charAt(0)) ? "\\b" : "";
  const end = WORD_CHAR.test(cue.charAt(cue.length - 1)) ? "\\b" : "";
  return new RegExp(`${start}${escapeRegExp(cue)}${end}`);
}

const CUE_PATTERNS: ReadonlyArray<readonly [CuedTaskType, ReadonlyArray<RegExp>]> =
  TYPE_PRECEDENCE.map((type) => [type, CUES[type].map(cuePattern)] as const);

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** `system` messages plus the last `user` message: older turns would dominate long chats. */
function inspectedText(messages: ReadonlyArray<Message>): string {
  const lastUser = messages.filter((message) => message.role === "user").at(-1);
  return messages
    .filter((message) => message.role === "system" || message === lastUser)
    .map((message) => normalize(contentOf(message)))
    .join("\n");
}

function taskTypeOf(messages: ReadonlyArray<Message>): TaskType {
  const text = inspectedText(messages);
  for (const [type, patterns] of CUE_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) {
      return type;
    }
  }
  return "chat";
}

function sizeOf(tokens: number): TaskSize {
  if (tokens <= SIZE_THRESHOLDS.short) return "short";
  if (tokens <= SIZE_THRESHOLDS.medium) return "medium";
  return "long";
}

/** Rough token estimate: one token per four characters, rounded up. */
export function estimateTokens(text: string): number {
  return tokensForLength(text.length);
}

function tokensForLength(characters: number): number {
  return Math.ceil(characters / 4);
}

/**
 * Classifies the messages by task type and size. The size counts every text the provider
 * reads: tool-call arguments, tool results and tool definitions too (009 tool-calling FR-008).
 */
export function classify(
  messages: ReadonlyArray<Message>,
  tools?: ReadonlyArray<ToolDefinition>,
): Classification {
  const texts = inspectedTexts(tools === undefined ? { messages } : { messages, tools });
  const characters = texts.reduce((total, { text }) => total + text.length, 0);
  const estimatedInputTokens = tokensForLength(characters);
  return {
    taskType: taskTypeOf(messages),
    size: sizeOf(estimatedInputTokens),
    estimatedInputTokens,
  };
}
