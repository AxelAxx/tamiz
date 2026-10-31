import {
  type AuditPageDto,
  type CostReportDto,
  HealthResponseSchema,
  type ProvidersReportDto,
  type SimulateResponse,
} from "@tamiz/contracts";
import { hc, type InferResponseType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { GatewayRoutes } from "../src/presentation/app.js";
import { ADMIN_AUTH, AUTH, createTestApp } from "./helpers/app.js";

// Spec 008 research R-02 (tasks.md T004): the chained route table types the dashboard's
// `hc` client, and chaining changed no behaviour.

type Client = ReturnType<typeof hc<GatewayRoutes>>;

describe("GatewayRoutes", () => {
  it("types the health, simulate and admin routes for hc", () => {
    const client = hc<GatewayRoutes>("http://gateway.test");
    expectTypeOf(client.health.$get).toBeFunction();
    expectTypeOf(client.v1.simulate.$post).toBeFunction();
    expectTypeOf(client.v1.admin.audit.$get).toBeFunction();
    expectTypeOf(client.v1.admin.cost.$get).toBeFunction();
    expectTypeOf(client.v1.admin.providers.$get).toBeFunction();
    expectTypeOf(client.v1.chat.completions.$post).toBeFunction();

    // JSON carries no brands: `uptimeMs` arrives as a plain number.
    expectTypeOf<InferResponseType<Client["health"]["$get"], 200>>().toMatchTypeOf<{
      status: "ok" | "degraded";
      version: string;
      uptimeMs: number;
    }>();
    expectTypeOf<
      InferResponseType<Client["v1"]["simulate"]["$post"], 200>
    >().toMatchTypeOf<SimulateResponse>();
    // JSON drops `undefined` optionals, so the entries are checked by their key fields.
    type AuditPage = InferResponseType<Client["v1"]["admin"]["audit"]["$get"], 200>;
    expectTypeOf<AuditPage["nextCursor"]>().toEqualTypeOf<AuditPageDto["nextCursor"]>();
    expectTypeOf<AuditPage["entries"][number]["id"]>().toEqualTypeOf<string>();
    expectTypeOf<AuditPage["entries"][number]["outcome"]>().toEqualTypeOf<
      AuditPageDto["entries"][number]["outcome"]
    >();
    expectTypeOf<
      InferResponseType<Client["v1"]["admin"]["cost"]["$get"], 200>
    >().toMatchTypeOf<CostReportDto>();
    expectTypeOf<
      InferResponseType<Client["v1"]["admin"]["providers"]["$get"], 200>
    >().toMatchTypeOf<ProvidersReportDto>();
  });

  it("the app built by createApp still answers every existing route", async () => {
    const { app } = await createTestApp();
    // `hc` driven in-process through the app's own fetch.
    const client = hc<GatewayRoutes>("http://gateway.test", {
      fetch: (input: string | URL | Request, init?: RequestInit) => app.request(input, init),
    });

    const health = await client.health.$get();
    expect(health.status).toBe(200);
    expect(HealthResponseSchema.safeParse(await health.json()).success).toBe(true);

    const simulate = await client.v1.simulate.$post(
      { json: { model: "tamiz-auto", messages: [{ role: "user", content: "Hola" }] } },
      { headers: AUTH },
    );
    expect(simulate.status).toBe(200);

    const audit = await client.v1.admin.audit.$get({ query: {} }, { headers: ADMIN_AUTH });
    expect(audit.status).toBe(200);

    const cost = await client.v1.admin.cost.$get(
      { query: { from: "2026-05-01T00:00:00.000Z", to: "2026-05-02T00:00:00.000Z" } },
      { headers: ADMIN_AUTH },
    );
    expect(cost.status).toBe(200);

    const providers = await client.v1.admin.providers.$get({ query: {} }, { headers: ADMIN_AUTH });
    expect(providers.status).toBe(200);

    // The admin routes still refuse a client key, and /v1/* still needs a key.
    const forbidden = await client.v1.admin.audit.$get({ query: {} }, { headers: AUTH });
    expect(forbidden.status).toBe(403);
    const unauthenticated = await client.v1.simulate.$post({
      json: { model: "tamiz-auto", messages: [{ role: "user", content: "Hola" }] },
    });
    expect(unauthenticated.status).toBe(401);

    const openapi = await app.request("/openapi.json");
    expect(openapi.status).toBe(200);
  });
});
