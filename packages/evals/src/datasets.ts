/**
 * Versioned JSONL datasets (spec 007 FR-002, research R-03, contracts/datasets.md).
 *
 * Line 1 is a header, every following line one case. Everything is validated before any
 * eval runs: a bad line stops the run with the file and line number, never with the line's
 * content (FR-005).
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ChatMessageSchema, PrivacyEntityKindSchema } from "@tamiz/contracts";
import { z } from "zod";

export const HeaderSchema = z.strictObject({
  dataset: z.string().min(1),
  version: z.int().min(1),
  synthetic: z.literal(true),
  language: z.array(z.enum(["es", "en"])).min(1),
  note: z.string().min(1),
  /** The policy file the expectations are bound to, relative to the repository root. */
  policy: z.string().min(1).optional(),
  generator: z.string().min(1).optional(),
  seed: z.int().optional(),
});
export type DatasetHeader = z.infer<typeof HeaderSchema>;

const Messages = z.array(ChatMessageSchema).min(1);
const Span = z.strictObject({
  kind: PrivacyEntityKindSchema,
  start: z.int().min(0),
  end: z.int().positive(),
});

export const RoutingCaseSchema = z.strictObject({
  id: z.string().regex(/^routing-\d{3,4}$/),
  messages: Messages,
  model: z.string().min(1).optional(),
  expected: z.strictObject({
    taskType: z.string().min(1),
    size: z.string().min(1),
    route: z.string().min(1),
  }),
});

export const LeakCaseSchema = z.strictObject({
  id: z.string().regex(/^pii-leak-\d{3,4}$/),
  messages: Messages,
  model: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)),
  values: z.array(Span.extend({ messageIndex: z.int().min(0) })),
});

export const DetectionCaseSchema = z.strictObject({
  id: z.string().regex(/^pii-detection-\d{3,4}$/),
  text: z.string().min(1),
  tags: z.array(z.string().min(1)),
  spans: z.array(Span),
});

export const QualityCaseSchema = z.strictObject({
  id: z.string().regex(/^quality-\d{3,4}$/),
  taskType: z.string().min(1),
  language: z.enum(["es", "en"]),
  messages: Messages,
  reference: z.string().min(1),
});

export type RoutingCase = z.infer<typeof RoutingCaseSchema>;
export type LeakCase = z.infer<typeof LeakCaseSchema>;
export type DetectionCase = z.infer<typeof DetectionCaseSchema>;
export type QualityCase = z.infer<typeof QualityCaseSchema>;

export interface Dataset<C> {
  readonly file: string;
  readonly header: DatasetHeader;
  readonly cases: ReadonlyArray<C>;
}

export class DatasetError extends Error {
  constructor(
    readonly file: string,
    readonly line: number,
    readonly problem: string,
  ) {
    super(`${file}:${line}: ${problem}`);
    this.name = "DatasetError";
  }
}

/** The first issue as `path: message`, which names fields, never values. */
function issue(error: z.ZodError): string {
  const first = error.issues[0];
  if (first === undefined) return "invalid";
  const path = first.path.join(".");
  return path === "" ? first.message : `${path}: ${first.message}`;
}

function checkOffsets(c: unknown): string | undefined {
  const leak = LeakCaseSchema.safeParse(c);
  if (leak.success) {
    for (const v of leak.data.values) {
      const content = leak.data.messages[v.messageIndex]?.content;
      if (content === undefined) return "values: messageIndex outside the messages";
      if (v.end <= v.start || v.end > content.length) return "values: offsets outside the message";
    }
  }
  const detection = DetectionCaseSchema.safeParse(c);
  if (detection.success) {
    for (const s of detection.data.spans) {
      if (s.end <= s.start || s.end > detection.data.text.length) {
        return "spans: offsets outside the text";
      }
    }
  }
  return undefined;
}

export async function loadDataset<C extends { id: string }>(
  path: string,
  name: string,
  caseSchema: z.ZodType<C>,
): Promise<Dataset<C>> {
  const file = basename(path);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new DatasetError(file, 0, "cannot be read");
  }
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const parse = (line: string, n: number): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      throw new DatasetError(file, n, "not valid JSON");
    }
  };

  const header = HeaderSchema.safeParse(parse(lines[0] ?? "", 1));
  if (!header.success) throw new DatasetError(file, 1, `header: ${issue(header.error)}`);
  if (header.data.dataset !== name) {
    throw new DatasetError(file, 1, `header: dataset must be "${name}"`);
  }

  const cases: C[] = [];
  const ids = new Set<string>();
  for (let i = 1; i < lines.length; i += 1) {
    const n = i + 1;
    const value = parse(lines[i] ?? "", n);
    const parsed = caseSchema.safeParse(value);
    if (!parsed.success) throw new DatasetError(file, n, issue(parsed.error));
    if (ids.has(parsed.data.id)) throw new DatasetError(file, n, `duplicate id ${parsed.data.id}`);
    const offsets = checkOffsets(value);
    if (offsets !== undefined) throw new DatasetError(file, n, offsets);
    ids.add(parsed.data.id);
    cases.push(parsed.data);
  }
  if (cases.length === 0) throw new DatasetError(file, 1, "no cases");
  return { file, header: header.data, cases };
}
