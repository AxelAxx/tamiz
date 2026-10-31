/**
 * Fixtures for the chat completion contract tests (spec US2, SC-004).
 * `validRequest` and `validResponse` are the happy path; `invalidRequests` and
 * `invalidResponses` are the invalid corpus, every entry of which must be rejected.
 */

export const validRequest = {
  model: "llama3.2",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Summarise this contract in three bullet points." },
  ],
  temperature: 0.2,
  max_tokens: 256,
  stream: false,
  user: "client-42",
} as const;

export const minimalRequest = {
  model: "llama3.2",
  messages: [{ role: "user", content: "Hello" }],
} as const;

export const validResponse = {
  id: "chatcmpl-abc123",
  object: "chat.completion",
  created: 1_729_250_000,
  model: "llama3.2",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Here are three bullet points." },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
} as const;

export interface InvalidSample {
  /** Short name used as the test title. */
  readonly name: string;
  /** The payload to validate; typed `unknown` because it is invalid by design. */
  readonly payload: unknown;
  /** Path (as Zod reports it) where the first issue is expected. */
  readonly path: readonly (string | number)[];
}

export const invalidRequests: readonly InvalidSample[] = [
  {
    name: "unknown top-level field",
    payload: { ...minimalRequest, parallel_tool_calls: true },
    path: [],
  },
  {
    name: 'temperature: "hot" (wrong type)',
    payload: { ...minimalRequest, temperature: "hot" },
    path: ["temperature"],
  },
  {
    name: 'messages: "hello" (wrong type)',
    payload: { ...minimalRequest, messages: "hello" },
    path: ["messages"],
  },
  {
    name: "empty messages",
    payload: { ...minimalRequest, messages: [] },
    path: ["messages"],
  },
  {
    name: 'role "function"',
    payload: { ...minimalRequest, messages: [{ role: "function", content: "x" }] },
    path: ["messages", 0, "role"],
  },
  {
    name: 'stream: "yes" (not a boolean)',
    payload: { ...minimalRequest, stream: "yes" },
    path: ["stream"],
  },
  {
    name: "temperature: 2.5 (out of range)",
    payload: { ...minimalRequest, temperature: 2.5 },
    path: ["temperature"],
  },
  {
    name: "max_tokens: 0 (not positive)",
    payload: { ...minimalRequest, max_tokens: 0 },
    path: ["max_tokens"],
  },
];

export const invalidResponses: readonly InvalidSample[] = [
  {
    name: "choices: []",
    payload: { ...validResponse, choices: [] },
    path: ["choices"],
  },
  {
    name: "unknown top-level field",
    payload: { ...validResponse, system_fingerprint: "fp_1" },
    path: [],
  },
];
