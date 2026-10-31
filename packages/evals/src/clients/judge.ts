/**
 * The judge model (spec 007 FR-011, FR-012, research R-07): an OpenAI-compatible chat
 * endpoint (Ollama locally and in CI), called directly with deterministic settings.
 *
 * The prompt is a versioned file; the judge never learns which route produced the answer.
 * A reply that is not the requested JSON is retried once, then reported as unparseable.
 */
import { z } from "zod";
import { ServiceError } from "../eval.js";

export interface JudgePrompt {
  /** `judge.v1`: recorded with every baseline. */
  readonly version: string;
  readonly template: string;
}

export type Judgement =
  | { readonly ok: true; readonly score: number; readonly rationale: string }
  | { readonly ok: false };

const ReplySchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});
const VerdictSchema = z.object({
  score: z.coerce.number().int().min(1).max(5),
  rationale: z.string().default(""),
});

export function renderPrompt(
  prompt: JudgePrompt,
  parts: { request: string; reference: string; answer: string },
): string {
  return prompt.template
    .replace("{{request}}", parts.request)
    .replace("{{reference}}", parts.reference)
    .replace("{{answer}}", parts.answer);
}

/** The first JSON object in the reply, as models sometimes wrap it in prose or fences. */
export function parseVerdict(reply: string): Judgement {
  const match = reply.match(/\{[\s\S]*?\}/);
  if (match === null) return { ok: false };
  try {
    const verdict = VerdictSchema.safeParse(JSON.parse(match[0]));
    return verdict.success
      ? { ok: true, score: verdict.data.score, rationale: verdict.data.rationale }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface JudgeClient {
  readonly model: string;
  judge(prompt: string): Promise<Judgement>;
}

export function createJudgeClient(options: {
  readonly baseUrl: string;
  readonly model: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}): JudgeClient {
  const base = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;

  async function ask(prompt: string): Promise<string> {
    let response: Response;
    try {
      response = await options.fetch(new URL("chat/completions", base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          seed: 42,
          stream: false,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new ServiceError("judge", timedOut ? "timeout" : "unavailable");
    }
    if (!response.ok) throw new ServiceError("judge", `http_${response.status}`);
    const reply = ReplySchema.safeParse(await response.json().catch(() => undefined));
    if (!reply.success) throw new ServiceError("judge", "contract");
    return reply.data.choices[0]?.message.content ?? "";
  }

  return {
    model: options.model,
    async judge(prompt) {
      const first = parseVerdict(await ask(prompt));
      return first.ok ? first : parseVerdict(await ask(prompt));
    },
  };
}
