import { describe, expect, it } from "vitest";
import type { Inspection } from "../../src/domain/model/sensitivity.js";
import { ok } from "../../src/domain/result.js";
import { createLogger } from "../../src/infrastructure/logging/logger.js";
import { fanOut } from "../../src/infrastructure/telemetry/fan-out.js";
import { createLogRoutingEvents } from "../../src/infrastructure/telemetry/log-routing-events.js";
import { AUTH, createTestApp, defaultPolicy } from "../helpers/app.js";
import { inspectAs } from "../helpers/privacy.js";
import { captureSpans } from "../helpers/tracing.js";

// Spec 005 US2-5, SC-006, FR-013 (tasks.md T029); spec 006 FR-015 (audit entries) and US5-4,
// FR-010 (spans, tasks.md T025): run the privacy scenarios with the real
// logger and the log sink of the routing events, and search everything the gateway
// writes or answers outside the response body for the test values and the mapping.

const VALUES = ["Lucía Fernández", "lucia@example.com", "12345678Z"] as const;
const TEXT = `Soy ${VALUES[0]}, escribe a ${VALUES[1]}; mi DNI es ${VALUES[2]}.`;

function inspection(level: "high" | "critical"): Inspection {
  const found = (kind: "PERSON" | "EMAIL" | "DNI", value: string) => {
    const start = TEXT.indexOf(value);
    return { textIndex: 0, kind, start, end: start + value.length, score: 0.9 };
  };
  const entities = [found("PERSON", VALUES[0]), found("EMAIL", VALUES[1])];
  return {
    status: "ok",
    level,
    entities: level === "critical" ? [...entities, found("DNI", VALUES[2])] : entities,
  };
}

function capture() {
  const chunks: string[] = [];
  const logger = createLogger({
    level: "debug",
    destination: { write: (c: string) => void chunks.push(c) },
  });
  const spans = captureSpans();
  return {
    logger,
    tracer: spans.tracer,
    events: fanOut(createLogRoutingEvents(logger), spans.events),
    raw: () => chunks.join(""),
    spans,
  };
}

describe("no request content outside the request (SC-006)", () => {
  it.each([
    ["anonymize", inspection("high"), undefined],
    ["restrict_to_local", inspection("critical"), undefined],
    ["block", inspection("critical"), "block" as const],
    ["detector failure", { status: "failed", reason: "contract" } as const, undefined],
  ])(
    "%s: logs, events, headers, entries and spans contain no value and no mapping",
    async (_name, found, critical) => {
      const { logger, tracer, events, raw, spans } = capture();
      const base = await defaultPolicy();
      const policy =
        critical === undefined
          ? base
          : {
              ...base,
              privacy: {
                ...base.privacy,
                levels: { ...base.privacy.levels, critical: { action: critical } },
              },
            };
      const { send, audit } = await createTestApp({
        logger,
        events,
        tracer,
        policy,
        inspect: inspectAs(found),
        script: (input) =>
          ok({
            text: `Respuesta para <PERSON_1> y <EMAIL_1>: ${input.messages.at(-1)?.content ?? ""}`,
            finishReason: "stop",
            usage: { promptTokens: 30, completionTokens: 8 },
            modelName: input.target.model,
          }),
      });

      const response = await send("/v1/chat/completions", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ model: "tamiz-auto", messages: [{ role: "user", content: TEXT }] }),
      });
      await response.text();

      const headers = JSON.stringify([...response.headers.entries()]);
      const written = raw();
      expect(written.length).toBeGreaterThan(0);
      for (const value of VALUES) {
        expect(written).not.toContain(value);
        expect(headers).not.toContain(value);
      }
      expect(written).not.toMatch(/<PERSON_1>|<EMAIL_1>/);
      // Spec 006 FR-003, FR-015: the audit entry has no content either.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const entries = JSON.stringify(audit.entries());
      expect(audit.size()).toBe(1);
      for (const value of VALUES) expect(entries).not.toContain(value);
      expect(entries).not.toMatch(/<PERSON_1>|<EMAIL_1>|Respuesta/);
      // Spec 006 US5-4, FR-010: spans neither, and no GenAI content attribute is ever set.
      const traced = spans.dump();
      expect(spans.spans().length).toBeGreaterThan(0);
      for (const value of VALUES) expect(traced).not.toContain(value);
      expect(traced).not.toMatch(/<PERSON_1>|<EMAIL_1>|Respuesta|Soy /);
      const keys = spans
        .spans()
        .flatMap((span) => [
          ...Object.keys(span.attributes),
          ...span.events.flatMap((event) => Object.keys(event.attributes ?? {})),
        ]);
      expect(
        keys.filter((key) =>
          /^gen_ai\.(.*message.*|prompt|completion|system_instructions)$/.test(key),
        ),
      ).toEqual([]);
    },
  );
});
