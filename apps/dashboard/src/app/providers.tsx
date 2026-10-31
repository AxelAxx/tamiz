"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { BffRequestError } from "@/lib/api-client";

/** One query client per tab; a 401 or 403 is never retried. */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchIntervalInBackground: false,
        retry: (failures, error) =>
          !(error instanceof BffRequestError && [400, 401, 403].includes(error.status)) &&
          failures < 2,
      },
    },
  });
}

export function Providers({ children }: { readonly children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
