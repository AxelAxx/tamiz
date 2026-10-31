/**
 * The browser's client of the dashboard's own endpoints (spec 008 FR-003, FR-006). It only
 * knows `/api/*`; every answer is parsed with its contract, and every error with
 * `BffErrorSchema`, before TanStack Query sees it.
 */
import {
  type AuditPageDto,
  AuditPageSchema,
  type AuditQueryDto,
  type ChatCompletionRequest,
  type CostQueryDto,
  type CostReportDto,
  CostReportSchema,
  type HealthResponse,
  HealthResponseSchema,
  type ProvidersReportDto,
  ProvidersReportSchema,
  type SimulateResponse,
  SimulateResponseSchema,
} from "@tamiz/contracts";
import type { z } from "zod";
import { type BffError, BffErrorSchema, OkSchema } from "./schemas";

export class BffRequestError extends Error {
  constructor(
    readonly status: number,
    /** The parsed BFF error; `undefined` when the answer was not one. */
    readonly body: BffError | undefined,
  ) {
    super(body?.error.message ?? `Request failed with status ${status}`);
    this.name = "BffRequestError";
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin" });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = BffErrorSchema.safeParse(body);
    throw new BffRequestError(response.status, error.success ? error.data : undefined);
  }
  return schema.parse(body);
}

function withQuery(path: string, query: Readonly<Record<string, unknown>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search === "" ? path : `${path}?${search}`;
}

const json = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  signIn: (passphrase: string) =>
    request("/api/session", OkSchema, { method: "POST", ...json({ passphrase }) }),
  signOut: () => request("/api/session", OkSchema, { method: "DELETE" }),
  gatewayHealth: (): Promise<HealthResponse> =>
    request("/api/gateway-health", HealthResponseSchema),
  audit: (query: Partial<AuditQueryDto> = {}): Promise<AuditPageDto> =>
    request(withQuery("/api/audit", query), AuditPageSchema),
  cost: (
    query: Pick<CostQueryDto, "from" | "to"> & Partial<CostQueryDto>,
  ): Promise<CostReportDto> => request(withQuery("/api/cost", query), CostReportSchema),
  providers: (query: { windowMinutes?: number } = {}): Promise<ProvidersReportDto> =>
    request(withQuery("/api/providers", query), ProvidersReportSchema),
  simulate: (body: ChatCompletionRequest): Promise<SimulateResponse> =>
    request("/api/simulate", SimulateResponseSchema, { method: "POST", ...json(body) }),
};
