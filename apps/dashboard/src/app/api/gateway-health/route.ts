import { HealthResponseSchema } from "@tamiz/contracts";
import { read } from "@/lib/server/bff";
import { serverContext } from "@/lib/server/context";
import { callGateway } from "@/lib/server/gateway";

/** `GET /api/gateway-health` → `GET /health` (spec 008 R-01). */
export const GET = read(async () => {
  const { gateway, log } = serverContext();
  return callGateway({
    endpoint: "/health",
    schema: HealthResponseSchema,
    call: () => gateway.health.$get(),
    log,
  });
});
