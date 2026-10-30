import {
  ChatCompletionChoiceSchema,
  ProviderNameSchema,
  ResidencySchema,
  TaskSizeSchema,
  TaskTypeSchema,
} from "@tamiz/contracts";
import { describe, expect, it } from "vitest";
import { FINISH_REASONS } from "../src/application/ports/llm-provider.port.js";
import { PROVIDER_NAMES, RESIDENCIES } from "../src/domain/model/model-target.js";
import { TASK_SIZES, TASK_TYPES } from "../src/domain/model/task-classifier.js";

// Spec 002 research R-03 (tasks.md T054): the closed lists are declared twice, in the
// domain and in the contracts; this test fails as soon as they drift apart.

describe("contract enums match the domain tuples (R-03)", () => {
  it.each([
    ["ProviderNameSchema", ProviderNameSchema.options, PROVIDER_NAMES],
    ["ResidencySchema", ResidencySchema.options, RESIDENCIES],
    ["TaskTypeSchema", TaskTypeSchema.options, TASK_TYPES],
    ["TaskSizeSchema", TaskSizeSchema.options, TASK_SIZES],
    ["finish_reason", ChatCompletionChoiceSchema.shape.finish_reason.options, FINISH_REASONS],
  ])("%s", (_name, contract, domain) => {
    expect([...contract]).toEqual([...domain]);
  });
});
