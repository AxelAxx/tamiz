import { AuditPageSchema, AuditQuerySchema } from "@tamiz/contracts";
import { read } from "@/lib/server/bff";
import { serverContext } from "@/lib/server/context";
import { callGateway } from "@/lib/server/gateway";
import { readQuery } from "@/lib/server/handler";
import { toQuery } from "@/lib/server/query";

/** `GET /api/audit` → `GET /v1/admin/audit` (spec 008 R-01). */
export const GET = read(async (request) => {
  const query = readQuery(request, AuditQuerySchema);
  if (!query.ok) return query.response;
  const { gateway, log } = serverContext();
  return callGateway({
    endpoint: "/v1/admin/audit",
    schema: AuditPageSchema,
    call: () => gateway.v1.admin.audit.$get({ query: toQuery(query.value) }),
    log,
  });
});
