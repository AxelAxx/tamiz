"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

/** Plain-text gateway status through `/api/gateway-health`; designed in `T-008-10`. */
export function GatewayStatus() {
  const health = useQuery({
    queryKey: ["gateway-health"],
    queryFn: api.gatewayHealth,
    refetchInterval: 30_000,
  });
  const text = health.isPending
    ? "checking"
    : health.isError
      ? "unreachable"
      : `${health.data.status} (${health.data.version})`;
  return <p data-testid="gateway-status">Gateway: {text}</p>;
}
