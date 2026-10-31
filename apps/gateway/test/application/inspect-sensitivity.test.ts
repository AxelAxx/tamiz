import { createHash } from "node:crypto";
import { createFakeClock, createScriptedPort } from "@tamiz/test-utils";
import { describe, expect, it } from "vitest";
import type { PiiDetectorPort } from "../../src/application/ports/pii-detector.port.js";
import {
  cacheKey,
  inspectSensitivity,
} from "../../src/application/use-cases/inspect-sensitivity.js";
import type { Inspection } from "../../src/domain/model/sensitivity.js";
import { millisecondsUnchecked, requestIdUnchecked } from "../../src/domain/model/units.js";
import { createInMemoryDetectionCache } from "../../src/infrastructure/cache/in-memory-detection-cache.js";
import { recordingEvents } from "../resilience/helpers.js";

// Spec 005 US3-1, US3-2, US7-1, US7-3, FR-008, FR-009, FR-015 (tasks.md T015).

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const CRITICAL: Inspection = {
  status: "ok",
  level: "critical",
  entities: [{ textIndex: 0, kind: "DNI", start: 9, end: 18, score: 1 }],
};
const MESSAGES = ["Mi DNI es 12345678Z"];
const REQUEST_ID = requestIdUnchecked("req-1");

type InspectInput = { messages: ReadonlyArray<string>; signal: AbortSignal };

function setup(script: (input: InspectInput, call: number) => Inspection | Promise<Inspection>) {
  const clock = createFakeClock();
  const port = createScriptedPort<InspectInput, Inspection>(script);
  const detector: PiiDetectorPort = {
    inspect: (messages, signal) => port.fn({ messages, signal }),
  };
  const cache = createInMemoryDetectionCache({
    maxEntries: 10,
    ttlMs: 60_000,
    now: () => clock.now(),
  });
  const events = recordingEvents();
  const inspect = inspectSensitivity({
    detector,
    cache,
    clock,
    events,
    hash: sha256,
    timeoutMs: millisecondsUnchecked(2_000),
  });
  return { clock, port, cache, events, inspect };
}

describe("inspectSensitivity", () => {
  it("returns the detector's inspection and records one `privacy.inspected` event, without content", async () => {
    const { inspect, events } = setup(() => CRITICAL);

    expect(await inspect({ requestId: REQUEST_ID, messages: MESSAGES })).toEqual(CRITICAL);
    expect(events.all).toEqual([
      expect.objectContaining({
        type: "privacy.inspected",
        requestId: REQUEST_ID,
        level: "critical",
        counts: { DNI: 1 },
        cached: false,
      }),
    ]);
    expect(JSON.stringify(events.all)).not.toContain("12345678Z");
  });

  it("US7-1: a repeated request is served from the cache without calling the detector", async () => {
    const { inspect, port, events } = setup(() => CRITICAL);

    await inspect({ requestId: REQUEST_ID, messages: MESSAGES });
    const second = await inspect({ requestId: REQUEST_ID, messages: MESSAGES });

    expect(second).toEqual(CRITICAL);
    expect(port.calls).toHaveLength(1);
    expect(events.all.at(-1)).toMatchObject({ type: "privacy.inspected", cached: true });
  });

  it("US7-3: different messages, or a different options version, miss", async () => {
    const { inspect, port } = setup(() => CRITICAL);
    await inspect({ requestId: REQUEST_ID, messages: MESSAGES });
    await inspect({ requestId: REQUEST_ID, messages: [...MESSAGES, "otra"] });
    expect(port.calls).toHaveLength(2);
    expect(cacheKey(sha256, ["a", "b"])).not.toBe(cacheKey(sha256, ["a\n\nb"]));
  });

  it("the cache key is a hash: it never contains the text", () => {
    expect(cacheKey(sha256, MESSAGES)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("US3-2: a detector slower than the timeout gives `timeout` at exactly the limit", async () => {
    const { inspect, clock, events } = setup(
      (input) =>
        new Promise<Inspection>((resolve) => {
          input.signal.addEventListener("abort", () =>
            resolve({ status: "failed", reason: "timeout" }),
          );
        }),
    );

    const pending = inspect({ requestId: REQUEST_ID, messages: MESSAGES });
    await Promise.resolve();
    clock.advance(1_999);
    await Promise.resolve();
    expect(clock.pendingSleeps()).toBe(1);
    clock.advance(1);

    await expect(pending).resolves.toEqual({ status: "failed", reason: "timeout" });
    expect(events.all).toEqual([
      expect.objectContaining({ type: "privacy.detector_failed", reason: "timeout" }),
    ]);
  });

  it("US3-1: failures are reported and never cached", async () => {
    const { inspect, port, cache } = setup((_input, call) =>
      call === 0 ? { status: "failed", reason: "unavailable" } : CRITICAL,
    );

    expect(await inspect({ requestId: REQUEST_ID, messages: MESSAGES })).toEqual({
      status: "failed",
      reason: "unavailable",
    });
    expect(cache.size()).toBe(0);
    expect(await inspect({ requestId: REQUEST_ID, messages: MESSAGES })).toEqual(CRITICAL);
    expect(port.calls).toHaveLength(2);
  });

  it("a client disconnect aborts the detector call", async () => {
    const client = new AbortController();
    const { inspect } = setup(
      (input) =>
        new Promise<Inspection>((resolve) => {
          input.signal.addEventListener("abort", () =>
            resolve({ status: "failed", reason: "timeout" }),
          );
        }),
    );

    const pending = inspect({ requestId: REQUEST_ID, messages: MESSAGES, signal: client.signal });
    client.abort();

    await expect(pending).resolves.toMatchObject({ status: "failed" });
  });

  it("leaves no pending timer behind after an answer", async () => {
    const { inspect, clock } = setup(() => CRITICAL);
    await inspect({ requestId: REQUEST_ID, messages: MESSAGES });
    expect(clock.pendingSleeps()).toBe(0);
  });
});
