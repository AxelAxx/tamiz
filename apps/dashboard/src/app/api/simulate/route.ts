import { ChatCompletionRequestSchema, SimulateResponseSchema } from "@tamiz/contracts";
import { write } from "@/lib/server/bff";
import { serverContext } from "@/lib/server/context";
import { callGateway } from "@/lib/server/gateway";
import { readJson } from "@/lib/server/handler";

/**
 * `POST /api/simulate` → `POST /v1/simulate` (spec 008 R-01). `stream` is dropped: a
 * simulation never streams. The body is never logged (FR-014).
 */
export const POST = write(async (request) => {
  const body = await readJson(request, ChatCompletionRequestSchema);
  if (!body.ok) return body.response;
  const { stream: _stream, stream_options: _options, ...json } = body.value;
  const { gateway, log } = serverContext();
  return callGateway({
    endpoint: "/v1/simulate",
    schema: SimulateResponseSchema,
    call: () => gateway.v1.simulate.$post({ json }),
    log,
  });
});
