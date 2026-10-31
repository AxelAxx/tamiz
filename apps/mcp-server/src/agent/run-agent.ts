/**
 * The dogfooding agent's tool loop (spec 009 FR-013 … FR-017, research R-09 … R-11,
 * data-model sections 4.2 and 4.3, contracts/agent-protocol.md).
 *
 * The agent lists the MCP server's tools and asks its model, through the Tamiz gateway, for
 * one JSON action per reply. A tool call runs over MCP and its result goes back as an
 * observation; an unknown tool, a bad format or a tool error goes back as an error
 * observation. The run stops on an answer, on a gateway error, or after `maxSteps` model
 * calls. The run record holds the tool arguments and the answer, never the tool results.
 *
 * Since the 009 tool-calling addendum (FR-025, research T-R14) the default protocol is
 * `native`: the MCP tools are declared as tools without `execute`, the model answers with
 * tool calls, each runs over MCP in order and goes back as a `tool` message, and a reply
 * without tool calls is the answer. `text` keeps the prompted JSON protocol above (R-10).
 */
import { readFileSync } from "node:fs";
import type { MCPClient } from "@ai-sdk/mcp";
import { McpToolErrorSchema } from "@tamiz/contracts";
import {
  APICallError,
  generateText,
  jsonSchema,
  type ModelMessage,
  type ToolSet,
  tool as toolDefinition,
} from "ai";
import { z } from "zod";
import { extractAction } from "./action.js";
import type { GatewayModel } from "./gateway-model.js";

export const TOOL_PROTOCOLS = ["native", "text"] as const;
export type ToolProtocol = (typeof TOOL_PROTOCOLS)[number];
export const DEFAULT_TOOL_PROTOCOL: ToolProtocol = "native";

/** The prompt of each protocol: `text` renders the tool list, `native` declares the tools. */
export const PROMPT_VERSIONS = { text: "system.v1", native: "system.v2" } as const;
export type PromptVersion = (typeof PROMPT_VERSIONS)[ToolProtocol];
export const PROMPT_VERSION = PROMPT_VERSIONS.text;
const promptFile = (version: PromptVersion) =>
  new URL(`../../prompts/${version}.md`, import.meta.url);

export const MAX_STEPS = 6;
export const OBSERVATION_LIMIT = 8_000;

const FORMAT_ERROR =
  'Observation error: answer with exactly one JSON object, {"tool": …, "arguments": …} or {"answer": …}';

export type AgentStep =
  | {
      kind: "tool";
      tool: string;
      arguments: unknown;
      requestId: string;
      ok: boolean;
      errorCode?: string;
      /** The model's tool-call id (native protocol). */
      callId?: string;
    }
  | { kind: "observation_error"; reason: "format" | "unknown_tool"; requestId: string }
  | { kind: "answer"; requestId: string };

export interface AgentRun {
  question: string;
  protocol: ToolProtocol;
  promptVersion: PromptVersion;
  model: string;
  /** The UTC date given to the prompt, `YYYY-MM-DD`. */
  today: string;
  steps: AgentStep[];
  /** The gateway's `x-request-id` of every model call, in order. */
  requestIds: string[];
  stopReason: "answered" | "step_limit" | "gateway_error";
  answer?: string;
  gatewayError?: { type: string; requestId?: string };
}

export interface RunAgentOptions {
  question: string;
  model: GatewayModel;
  mcp: MCPClient;
  now: () => Date;
  /** `native` (default) or `text` (spec 009 R-10). */
  protocol?: ToolProtocol;
  maxSteps?: number;
  observationLimit?: number;
}

interface ToolOutcome {
  ok: boolean;
  observation: string;
  errorCode?: string;
}

/** What an MCP tool's `execute` returns: the tool result, untouched. */
const ToolResultShape = z.looseObject({
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).optional(),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

/** A gateway error envelope, read loosely: only the type and the request id matter here. */
const GatewayErrorShape = z.looseObject({
  error: z.looseObject({ type: z.string(), requestId: z.string().optional() }),
});

type ListedTools = Awaited<ReturnType<MCPClient["listTools"]>>;

export async function runAgent(options: RunAgentOptions): Promise<AgentRun> {
  const protocol = options.protocol ?? DEFAULT_TOOL_PROTOCOL;
  const today = options.now().toISOString().slice(0, 10);
  const listed = await options.mcp.listTools();
  const run: AgentRun = {
    question: options.question,
    protocol,
    promptVersion: PROMPT_VERSIONS[protocol],
    model: options.model.id,
    today,
    steps: [],
    requestIds: [],
    stopReason: "step_limit",
  };
  return protocol === "native" ? runNative(options, listed, run) : runText(options, listed, run);
}

/** Spec 009 R-10: one JSON action per reply, observations as user messages. */
async function runText(
  options: RunAgentOptions,
  listed: ListedTools,
  run: AgentRun,
): Promise<AgentRun> {
  const maxSteps = options.maxSteps ?? MAX_STEPS;
  const limit = options.observationLimit ?? OBSERVATION_LIMIT;
  const tools = options.mcp.toolsFromDefinitions(listed);
  const names = listed.tools.map((tool) => tool.name);
  // The system prompt goes in `system`, which the provider sends as the first message.
  const system = systemPrompt(run.promptVersion, run.today, listed.tools);
  const messages: ModelMessage[] = [{ role: "user", content: options.question }];

  for (let step = 1; step <= maxSteps; step += 1) {
    let text: string;
    let requestId: string;
    try {
      const reply = await generateText({
        model: options.model.model,
        system,
        messages,
        temperature: 0,
        maxRetries: 0,
      });
      text = reply.text;
      requestId = reply.response.headers?.["x-request-id"] ?? "";
    } catch (error) {
      const gatewayError = toGatewayError(error);
      if (gatewayError.requestId !== undefined) run.requestIds.push(gatewayError.requestId);
      return { ...run, stopReason: "gateway_error", gatewayError };
    }
    run.requestIds.push(requestId);
    messages.push({ role: "assistant", content: text });

    const action = extractAction(text);
    if (!action.ok) {
      run.steps.push({ kind: "observation_error", reason: "format", requestId });
      messages.push({ role: "user", content: FORMAT_ERROR });
      continue;
    }
    if ("answer" in action.value) {
      run.steps.push({ kind: "answer", requestId });
      return { ...run, stopReason: "answered", answer: action.value.answer };
    }

    const { tool, arguments: args } = action.value;
    const execute = names.includes(tool) ? tools[tool]?.execute : undefined;
    if (execute === undefined) {
      run.steps.push({ kind: "observation_error", reason: "unknown_tool", requestId });
      messages.push({
        role: "user",
        content: `Observation error: unknown tool ${JSON.stringify(tool)}; available: ${names.join(", ")}`,
      });
      continue;
    }

    const outcome = await callTool(() => execute(args, { toolCallId: `step-${step}`, messages }));
    run.steps.push({
      kind: "tool",
      tool,
      arguments: args,
      requestId,
      ok: outcome.ok,
      ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
    });
    const prefix = outcome.ok ? `Observation (${tool}): ` : `Observation (${tool}) error: `;
    messages.push({ role: "user", content: prefix + truncate(outcome.observation, limit) });
  }

  return { ...run, answer: `I could not answer within ${maxSteps} steps` };
}

/** The MCP tools as model tools without `execute`: the agent runs every call itself. */
function declaredTools(listed: ListedTools): ToolSet {
  return Object.fromEntries(
    listed.tools.map((listedTool) => [
      listedTool.name,
      toolDefinition({
        ...(listedTool.description === undefined ? {} : { description: listedTool.description }),
        inputSchema: jsonSchema(listedTool.inputSchema as Parameters<typeof jsonSchema>[0]),
      }),
    ]),
  );
}

/** 009 tool-calling FR-025: native tool calls, results as `tool` messages. */
async function runNative(
  options: RunAgentOptions,
  listed: ListedTools,
  run: AgentRun,
): Promise<AgentRun> {
  const maxSteps = options.maxSteps ?? MAX_STEPS;
  const limit = options.observationLimit ?? OBSERVATION_LIMIT;
  const tools = options.mcp.toolsFromDefinitions(listed);
  const names = listed.tools.map((listedTool) => listedTool.name);
  const declared = declaredTools(listed);
  const system = systemPrompt(run.promptVersion, run.today, listed.tools);
  const messages: ModelMessage[] = [{ role: "user", content: options.question }];

  for (let step = 1; step <= maxSteps; step += 1) {
    let reply: Awaited<ReturnType<typeof generateText>>;
    try {
      reply = await generateText({
        model: options.model.model,
        system,
        messages,
        tools: declared,
        temperature: 0,
        maxRetries: 0,
      });
    } catch (error) {
      const gatewayError = toGatewayError(error);
      if (gatewayError.requestId !== undefined) run.requestIds.push(gatewayError.requestId);
      return { ...run, stopReason: "gateway_error", gatewayError };
    }
    const requestId = reply.response.headers?.["x-request-id"] ?? "";
    run.requestIds.push(requestId);
    if (reply.toolCalls.length === 0) {
      run.steps.push({ kind: "answer", requestId });
      return { ...run, stopReason: "answered", answer: reply.text.trim() };
    }
    messages.push(...reply.response.messages);

    const results: ModelMessage = { role: "tool", content: [] };
    for (const call of reply.toolCalls) {
      const execute = names.includes(call.toolName) ? tools[call.toolName]?.execute : undefined;
      if (execute === undefined || call.invalid === true) {
        // The SDK already answered an unknown tool or unparsable arguments with an error
        // result in `response.messages`; the model sees it on the next call.
        const reason = execute === undefined ? "unknown_tool" : "format";
        run.steps.push({ kind: "observation_error", reason, requestId });
        continue;
      }
      const outcome = await callTool(() =>
        execute(call.input, { toolCallId: call.toolCallId, messages }),
      );
      run.steps.push({
        kind: "tool",
        tool: call.toolName,
        arguments: call.input,
        requestId,
        ok: outcome.ok,
        callId: call.toolCallId,
        ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
      });
      const observation = (outcome.ok ? "" : "error: ") + truncate(outcome.observation, limit);
      results.content.push({
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: "text", value: observation },
      });
    }
    if (results.content.length > 0) messages.push(results);
  }

  return { ...run, answer: `I could not answer within ${maxSteps} steps` };
}

function systemPrompt(
  version: PromptVersion,
  today: string,
  tools: readonly { name: string; description?: string | undefined; inputSchema: unknown }[],
): string {
  const rendered = tools
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description ?? ""}\n  input JSON Schema: ${JSON.stringify(tool.inputSchema)}`,
    )
    .join("\n");
  return readFileSync(promptFile(version), "utf8")
    .replaceAll("{{today}}", today)
    .replaceAll("{{tools}}", rendered);
}

async function callTool(execute: () => PromiseLike<unknown> | unknown): Promise<ToolOutcome> {
  let raw: unknown;
  try {
    raw = await execute();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, observation: JSON.stringify({ error: message }), errorCode: "mcp_error" };
  }
  const result = ToolResultShape.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      observation: "the tool returned an unreadable result",
      errorCode: "mcp_error",
    };
  }
  const text = (result.data.content ?? [])
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
  if (result.data.isError === true) {
    return { ok: false, observation: text, errorCode: toolErrorCode(text) };
  }
  const value = result.data.structuredContent;
  return { ok: true, observation: value === undefined ? text : JSON.stringify(value) };
}

function toolErrorCode(text: string): string {
  if (text.startsWith("Input validation error")) return "invalid_arguments";
  try {
    const parsed = McpToolErrorSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data.error.code;
  } catch {
    // Not JSON: an SDK error message.
  }
  return "tool_error";
}

function toGatewayError(error: unknown): { type: string; requestId?: string } {
  if (!APICallError.isInstance(error)) return { type: "gateway_unreachable" };
  const header = error.responseHeaders?.["x-request-id"];
  let envelope: z.infer<typeof GatewayErrorShape> | undefined;
  try {
    const parsed = GatewayErrorShape.safeParse(JSON.parse(error.responseBody ?? ""));
    if (parsed.success) envelope = parsed.data;
  } catch {
    // Not a JSON envelope: keep the status.
  }
  const type = envelope?.error.type ?? `http_${error.statusCode ?? "unknown"}`;
  const requestId = header ?? envelope?.error.requestId;
  return requestId === undefined ? { type } : { type, requestId };
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… (truncated, ${text.length - limit} characters omitted)`;
}
