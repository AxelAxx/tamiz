import { createInMemoryCircuitState } from "../../src/infrastructure/cache/in-memory-circuit-state.js";
import { describeCircuitStateContract } from "./circuit-state-contract.js";

// Spec 003 FR-010 (tasks.md T012): the in-memory adapter for one instance and for tests.

describeCircuitStateContract("in-memory circuit state", (clock) =>
  createInMemoryCircuitState(clock),
);
