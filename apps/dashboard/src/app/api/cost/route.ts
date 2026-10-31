import { CostQuerySchema, CostReportSchema } from "@tamiz/contracts";
import { read } from "@/lib/server/bff";
import { serverContext } from "@/lib/server/context";
import { callGateway } from "@/lib/server/gateway";
import { readQuery } from "@/lib/server/handler";
import { toQuery } from "@/lib/server/query";

/** `GET /api/cost` → `GET /v1/admin/cost` (spec 008 R-01). */
export const GET = read(async (request) => {
  const query = readQuery(request, CostQuerySchema);
  if (!query.ok) return query.response;
  const { gateway, log } = serverContext();
  return callGateway({
    endpoint: "/v1/admin/cost",
    schema: CostReportSchema,
    call: () =>
      gateway.v1.admin.cost.$get({
        query: { ...toQuery(query.value), from: query.value.from, to: query.value.to },
      }),
    log,
  });
});
