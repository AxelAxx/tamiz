/**
 * PII leak eval (spec 007 US2, FR-006, FR-007, research R-04).
 *
 * Each case goes through the gateway's simulation endpoint, which runs the real inspection,
 * policy and anonymization. What a provider would receive is `providerMessages` when the
 * request is anonymized, the original messages otherwise. An annotated value leaks when
 * it appears verbatim (NFC) in any of those messages and the decided chain has a target
 * outside `local` residency, fallbacks included. Blocked requests leak nothing.
 *
 * Tool calling (009 tool-calling FR-021 … FR-024): what is sent also includes every tool
 * call's arguments and every tool result; a value may sit in a call's arguments
 * (`location`). Values in tool messages are counted apart (`values.tool_messages`, gated)
 * and their leak rate reported (`leak_rate.tool_messages`).
 *
 * The observation keeps one boolean per value: the texts never leave `observe`.
 */
import type { ChatMessage, EvalFailingCase, PrivacyEntityKindDto } from "@tamiz/contracts";
import { createGatewayClient, type SimulateResponse } from "../clients/gateway.js";
import { type LeakCase, LeakCaseSchema } from "../datasets.js";
import { type Eval, ServiceError } from "../eval.js";

export interface LeakObservation {
  readonly decision: "route" | "block";
  readonly privacyAction: string;
  readonly sensitivity: string;
  readonly chain: string;
  readonly nonLocal: boolean;
  /** Per annotated value, in order: does it appear verbatim in what would be sent? */
  readonly sentVerbatim: ReadonlyArray<boolean>;
}

export interface LeakOutcome {
  readonly leaked: ReadonlyArray<boolean>;
  readonly observation: LeakObservation;
}

const nfc = (text: string) => text.normalize("NFC");

/** Every text of a message a provider reads: its content and its tool calls' arguments. */
function textsOf(message: ChatMessage): string[] {
  const content = message.content ?? "";
  if (message.role !== "assistant") return [content];
  return [content, ...(message.tool_calls ?? []).map((call) => call.function.arguments)];
}

type LeakValue = LeakCase["values"][number];

/** The text a value is annotated in: a message's content or a tool call's arguments. */
function locatedText(c: LeakCase, value: LeakValue): string {
  const message = c.messages[value.messageIndex];
  if (message === undefined) return "";
  if (value.location?.kind === "arguments" && message.role === "assistant") {
    return message.tool_calls?.[value.location.toolCallIndex]?.function.arguments ?? "";
  }
  return message.content ?? "";
}

/** True when the value is in a tool call's arguments or in a tool result. */
export function inToolMessage(c: LeakCase, value: LeakValue): boolean {
  return value.location?.kind === "arguments" || c.messages[value.messageIndex]?.role === "tool";
}

/** Pure: what a provider would receive and whether each value is in it. */
export function observeSimulation(c: LeakCase, simulated: SimulateResponse): LeakObservation {
  const sent = (simulated.providerMessages ?? c.messages).flatMap(textsOf).map(nfc);
  return {
    decision: simulated.decision,
    privacyAction: simulated.privacyAction,
    sensitivity: simulated.sensitivity,
    chain: simulated.chain.map((t) => t.id).join(","),
    nonLocal: simulated.chain.some((t) => t.residency !== "local"),
    sentVerbatim: c.values.map((v) => {
      const value = nfc(locatedText(c, v).slice(v.start, v.end));
      return value !== "" && sent.some((text) => text.includes(value));
    }),
  };
}

export function scoreLeak(observation: LeakObservation): LeakOutcome {
  const exposed = observation.decision === "route" && observation.nonLocal;
  return { leaked: observation.sentVerbatim.map((sent) => exposed && sent), observation };
}

export const leakEval: Eval<LeakCase, LeakObservation, LeakOutcome> = {
  id: "leak",
  dataset: { file: "pii-leak-es.v2.jsonl", name: "pii-leak-es", schema: LeakCaseSchema },
  requires: ["TAMIZ_EVAL_GATEWAY_URL", "TAMIZ_EVAL_API_KEY"],

  prepare({ config, fetch }) {
    const gateway = createGatewayClient({
      baseUrl: config.TAMIZ_EVAL_GATEWAY_URL ?? "",
      apiKey: config.TAMIZ_EVAL_API_KEY ?? "",
      fetch,
    });
    return {
      async observe(c) {
        const simulated = await gateway.simulate(c.messages, c.model, c.tools);
        // A fail-closed route would hide a detection gap: the run did not measure detection.
        if (simulated.detector !== "ok") throw new ServiceError("privacy", "detector_failed");
        return observeSimulation(c, simulated);
      },
    };
  },

  score: (_c, observation) => scoreLeak(observation),

  summarize(results) {
    const totals = new Map<PrivacyEntityKindDto, { values: number; leaked: number }>();
    const tools = { values: 0, leaked: 0 };
    const failing: EvalFailingCase[] = [];
    for (const { c, result } of results) {
      c.values.forEach((v, i) => {
        const t = totals.get(v.kind) ?? { values: 0, leaked: 0 };
        const leaked = result.leaked[i] === true;
        totals.set(v.kind, { values: t.values + 1, leaked: t.leaked + (leaked ? 1 : 0) });
        if (inToolMessage(c, v)) {
          tools.values += 1;
          tools.leaked += leaked ? 1 : 0;
        }
        if (leaked) {
          failing.push({
            id: c.id,
            reason: "value would reach a non-local target verbatim",
            expected: { kind: v.kind, messageIndex: v.messageIndex, start: v.start, end: v.end },
            actual: {
              privacyAction: result.observation.privacyAction,
              sensitivity: result.observation.sensitivity,
              chain: result.observation.chain,
            },
          });
        }
      });
    }
    const kinds = [...totals.keys()].sort();
    return {
      metrics: [
        ...kinds.map((kind) => {
          const t = totals.get(kind) ?? { values: 0, leaked: 0 };
          return { name: `leak_rate.${kind}`, value: t.leaked / t.values, unit: "ratio" as const };
        }),
        ...kinds.map((kind) => ({
          name: `values.${kind}`,
          value: totals.get(kind)?.values ?? 0,
          unit: "count" as const,
        })),
        { name: "values.tool_messages", value: tools.values, unit: "count" },
        ...(tools.values === 0
          ? []
          : [
              {
                name: "leak_rate.tool_messages",
                value: tools.leaked / tools.values,
                unit: "ratio" as const,
              },
            ]),
        { name: "cases", value: results.length, unit: "count" },
      ],
      failing,
    };
  },
};
