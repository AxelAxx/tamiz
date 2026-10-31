import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AuditEntryDto,
  AuditEntrySchema,
  type AuditPageDto,
  AuditPageSchema,
  type CostReportDto,
  CostReportSchema,
  type ProvidersReportDto,
  ProvidersReportSchema,
  type SimulateResponse,
  SimulateResponseSchema,
} from "@tamiz/contracts";

/**
 * Gateway answers the fake serves (research R-12). Each one is parsed with its response
 * contract at load, so a fixture that drifts from the contract fails every test at once.
 */

const SPECS = resolve(import.meta.dirname, "../../../../specs");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(SPECS, path), "utf8"));
}

/** Synthetic text with a synthetic, checksum-valid DNI. */
export const DNI_TEXT = "Resume el expediente del paciente con DNI 12345678Z";

export const SIMULATE_DNI: SimulateResponse = SimulateResponseSchema.parse({
  sensitivity: "critical",
  detector: "ok",
  entities: [{ messageIndex: 0, kind: "DNI", start: 42, end: 51, score: 0.99 }],
  ruleId: "default",
  taskType: "summarize",
  size: "short",
  decision: "route",
  privacyAction: "restrict_to_local",
  chain: [{ id: "ollama-llama", provider: "ollama", model: "llama3.1:8b", residency: "local" }],
  allowedResidencies: ["local"],
});

const toolResultExample = readJson("009-mcp-agent/contracts/tool-result.example.json") as {
  success: { result: { structuredContent: unknown } };
};

export const PROVIDERS: ProvidersReportDto = ProvidersReportSchema.parse(
  toolResultExample.success.result.structuredContent,
);

const entry: AuditEntryDto = AuditEntrySchema.parse(
  readJson("006-audit-and-telemetry/contracts/audit-entry.example.json"),
);

export const AUDIT_ENTRY = entry;

/** Two pages: the first points at the second with `page-2`. */
export const AUDIT_PAGES: Readonly<Record<"first" | "second", AuditPageDto>> = {
  first: AuditPageSchema.parse({ entries: [entry], nextCursor: "page-2" }),
  second: AuditPageSchema.parse({
    entries: [{ ...entry, id: "5f0c8a3e-2b7d-4c1a-9e6f-1d2c3b4a5e61", requestId: "req-7f3b" }],
    nextCursor: null,
  }),
};

export const COST_REPORT: CostReportDto = CostReportSchema.parse(
  readJson("006-audit-and-telemetry/contracts/cost-report.example.json"),
);
