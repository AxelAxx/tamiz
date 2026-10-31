import { SimulateResponseSchema, SimulateRoutingInputSchema } from "@tamiz/contracts";
import { defineTool } from "./definition.js";

/** `simulate_routing` → `POST /v1/simulate` (spec 009 FR-008, contracts/tools.md). */
export const simulateRouting = defineTool({
  name: "simulate_routing",
  title: "Simulate routing",
  description:
    "Dry-run the Tamiz routing and privacy policy on a text or a list of chat messages. " +
    "Returns what would be detected (kinds and positions, never values), the matched rule, " +
    "the privacy action and the target chain. No model is called. " +
    "Give exactly one of `text` or `messages`.",
  inputSchema: SimulateRoutingInputSchema,
  outputSchema: SimulateResponseSchema,
  gatewayCall: { method: "POST", path: "/v1/simulate" },
  run: (input, { gateway, simulateModel }) =>
    gateway.simulate({
      model: input.model ?? simulateModel,
      messages: input.messages ?? [{ role: "user", content: input.text ?? "" }],
    }),
});
