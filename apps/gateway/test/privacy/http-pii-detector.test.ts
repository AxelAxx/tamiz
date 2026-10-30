import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  createHttpPiiDetector,
  MESSAGE_SEPARATOR,
} from "../../src/infrastructure/privacy/http-pii-detector.js";
import { useMswServer } from "../llm/msw.js";

// Spec 005 FR-007, US3-3, research R-02, R-03 (tasks.md T013).

const BASE = "http://privacy.test";
const server = useMswServer();
const detector = createHttpPiiDetector({ baseUrl: BASE });
const signal = () => new AbortController().signal;

/** Code-point offsets of `value` in `text`, as the Python service reports them. */
function cp(text: string, value: string): { start: number; end: number } {
  const startUnits = text.indexOf(value);
  const start = Array.from(text.slice(0, startUnits)).length;
  return { start, end: start + Array.from(value).length };
}

function answer(findings: unknown[], level = "high", status = 200) {
  return http.post(`${BASE}/analyze`, () =>
    HttpResponse.json({ findings, counts: {}, sensitivity_level: level }, { status }),
  );
}

describe("createHttpPiiDetector", () => {
  it("sends the messages joined by a blank line and maps findings back to each message", async () => {
    const messages = ["Eres un asistente.", "Soy Ana Ruiz, DNI 12345678Z"];
    const joined = messages.join(MESSAGE_SEPARATOR);
    let sent: unknown;
    server.use(
      http.post(`${BASE}/analyze`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          findings: [
            { kind: "PERSON", ...cp(joined, "Ana Ruiz"), score: 0.85 },
            { kind: "DNI", ...cp(joined, "12345678Z"), score: 1 },
          ],
          counts: { PERSON: 1, DNI: 1 },
          sensitivity_level: "critical",
        });
      }),
    );

    const inspection = await detector.inspect(messages, signal());

    expect(sent).toEqual({ text: joined });
    expect(inspection).toEqual({
      status: "ok",
      level: "critical",
      entities: [
        { messageIndex: 1, kind: "PERSON", start: 4, end: 12, score: 0.85 },
        { messageIndex: 1, kind: "DNI", start: 18, end: 27, score: 1 },
      ],
    });
  });

  it("converts code points to UTF-16 indices (an emoji before a finding)", async () => {
    const messages = ["Hola 👋🏽 soy Lucía, lucia@example.com"];
    const text = messages[0] ?? "";
    server.use(answer([{ kind: "EMAIL", ...cp(text, "lucia@example.com"), score: 1 }]));

    const inspection = await detector.inspect(messages, signal());

    if (inspection.status !== "ok") throw new Error("expected ok");
    const [entity] = inspection.entities;
    expect(entity === undefined ? "" : text.slice(entity.start, entity.end)).toBe(
      "lucia@example.com",
    );
  });

  it.each([
    ["a 5xx", http.post(`${BASE}/analyze`, () => new HttpResponse("boom", { status: 502 }))],
    [
      "503 not_ready",
      http.post(`${BASE}/analyze`, () =>
        HttpResponse.json(
          { error: { type: "not_ready", message: "Service is not ready", field: null } },
          { status: 503 },
        ),
      ),
    ],
    ["a network error", http.post(`${BASE}/analyze`, () => HttpResponse.error())],
  ])("%s is `unavailable`", async (_name, handler) => {
    server.use(handler);
    expect(await detector.inspect(["hola"], signal())).toEqual({
      status: "failed",
      reason: "unavailable",
    });
  });

  it.each([
    ["a body that is not JSON", http.post(`${BASE}/analyze`, () => new HttpResponse("{nope"))],
    ["a missing field", http.post(`${BASE}/analyze`, () => HttpResponse.json({ findings: [] }))],
    ["an unknown kind", answer([{ kind: "PASSPORT", start: 0, end: 4, score: 1 }])],
    ["an offset past the end", answer([{ kind: "PERSON", start: 0, end: 99, score: 1 }])],
    ["a 4xx", answer([], "none", 400)],
  ])("US3-3: %s is a `contract` failure, never `none`", async (_name, handler) => {
    server.use(handler);
    expect(await detector.inspect(["hola"], signal())).toEqual({
      status: "failed",
      reason: "contract",
    });
  });

  it("a finding that crosses the separator between two messages is a `contract` failure", async () => {
    const messages = ["Ana", "Ruiz"];
    server.use(answer([{ kind: "PERSON", start: 0, end: 9, score: 0.85 }]));

    expect(await detector.inspect(messages, signal())).toEqual({
      status: "failed",
      reason: "contract",
    });
  });

  it("an aborted call is a `timeout`, and nothing from the text is thrown", async () => {
    const controller = new AbortController();
    server.use(
      http.post(`${BASE}/analyze`, async () => {
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({ findings: [], counts: {}, sensitivity_level: "none" });
      }),
    );

    await expect(detector.inspect(["Ana Ruiz"], controller.signal)).resolves.toEqual({
      status: "failed",
      reason: "timeout",
    });
  });

  it("no findings is level `none` with no entities", async () => {
    server.use(answer([], "none"));
    expect(await detector.inspect(["¿Qué hora es?"], signal())).toEqual({
      status: "ok",
      level: "none",
      entities: [],
    });
  });
});
