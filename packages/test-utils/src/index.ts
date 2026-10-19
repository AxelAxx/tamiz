/**
 * @tamiz/test-utils — in-memory fakes and builders so use cases are tested without
 * network, database or the real clock (constitution VIII, spec FR-025).
 */
export {
  type ChatCompletionRequestOverrides,
  type ChatCompletionResponseOverrides,
  chatCompletionRequest,
  chatCompletionResponse,
  type HealthResponseOverrides,
  healthResponse,
} from "./builders.js";
export { createFakeClock, type FakeClock } from "./fake-clock.js";
