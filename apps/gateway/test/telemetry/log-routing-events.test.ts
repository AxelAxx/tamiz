import { describe, expect, it } from "vitest";
import type { RoutingEvent } from "../../src/application/ports/routing-events.port.js";
import { requestIdUnchecked, targetIdUnchecked } from "../../src/domain/model/units.js";
import { createLogger } from "../../src/infrastructure/logging/logger.js";
import { createLogRoutingEvents } from "../../src/infrastructure/telemetry/log-routing-events.js";
import { recordingLogger } from "../helpers/noop-logger.js";

// Spec 003 US5-3, US5-4, FR-017, FR-018, research R-12 (tasks.md T025): without another
// sink, each routing event is one structured log line, and no line carries content.

const BASE = {
  requestId: requestIdUnchecked("req-log"),
  targetId: targetIdUnchecked("mistral-small"),
  provider: "mistral",
  residency: "eu",
  at: "2026-01-01T00:00:00.000Z",
} as const;

const EVENTS: ReadonlyArray<readonly [RoutingEvent, "info" | "warn"]> = [
  [{ ...BASE, type: "attempt.started", attempt: 1 }, "info"],
  [{ ...BASE, type: "attempt.succeeded", attempt: 1, durationMs: 12 }, "info"],
  [{ ...BASE, type: "attempt.failed", attempt: 1, durationMs: 12, reason: "timeout" }, "info"],
  [{ ...BASE, type: "retry.scheduled", attempt: 1, waitMs: 125, reason: "timeout" }, "info"],
  [{ ...BASE, type: "fallback", reason: "timeout" }, "info"],
  [{ ...BASE, type: "target.skipped", reason: "circuit_open" }, "info"],
  [{ ...BASE, type: "residency.blocked", allowed: ["local"] }, "warn"],
  [{ ...BASE, type: "circuit.changed", from: "closed", to: "open" }, "warn"],
  [{ ...BASE, type: "circuit.changed", from: "half_open", to: "closed" }, "info"],
  [{ ...BASE, type: "stream.failed", reason: "network" }, "warn"],
];

describe("createLogRoutingEvents (US5-4)", () => {
  it.each(EVENTS)("writes %o as one line at the documented level", (event, level) => {
    const { logger, entries } = recordingLogger();

    createLogRoutingEvents(logger).emit(event);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe(level);
    expect(entries[0]?.message).toBe("routing event");
    const { type, ...fields } = event;
    expect(entries[0]?.bindings).toEqual({ event: type, ...fields });
  });

  it("works with the real pino logger (its methods need their `this`)", () => {
    const chunks: string[] = [];
    const logger = createLogger({
      level: "info",
      destination: { write: (chunk: string) => void chunks.push(chunk) },
    });
    const sink = createLogRoutingEvents(logger);

    for (const [event] of EVENTS) sink.emit(event);

    const lines = chunks
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(EVENTS.length);
    expect(lines[6]).toMatchObject({
      level: "warn",
      event: "residency.blocked",
      msg: "routing event",
    });
  });

  it("never throws into the request, even when the logger does", () => {
    const throwing = {
      debug: () => {},
      info: () => {
        throw new Error("disk full");
      },
      warn: () => {
        throw new Error("disk full");
      },
      error: () => {},
    };

    expect(() =>
      createLogRoutingEvents(throwing).emit(EVENTS[0]?.[0] as RoutingEvent),
    ).not.toThrow();
  });

  it("US5-3: the event type has no field that could carry content, so none is logged", () => {
    const { logger, entries } = recordingLogger();
    const marker = "PROMPT-MARKER-confidential";
    // A sink receives only typed events; extra properties a caller might smuggle in are
    // dropped, not forwarded.
    const smuggled = {
      ...EVENTS[0]?.[0],
      messages: [{ content: marker }],
    } as unknown as RoutingEvent;

    createLogRoutingEvents(logger).emit(smuggled);

    expect(JSON.stringify(entries)).not.toContain(marker);
  });
});
