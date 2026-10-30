/**
 * Boot cross-check between the policy and the provider settings (spec 002 FR-021,
 * research R-12): every provider a target uses must be configured. The message names
 * the target and the missing variable, never a configured value.
 */
import {
  type ConfigurationError,
  configurationError,
  type ErrorIssue,
} from "../../domain/errors.js";
import type { ProviderName } from "../../domain/model/model-target.js";
import type { RoutingPolicy } from "../../domain/model/routing-policy.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { ProviderSettings } from "../llm/settings.js";

/** The variable that configures each provider. */
const REQUIRED_SETTING: Readonly<Record<ProviderName, string>> = {
  ollama: "OLLAMA_BASE_URL",
  mistral: "MISTRAL_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function checkProviderSettings(
  policy: RoutingPolicy,
  config: { readonly providers: ProviderSettings },
): Result<void, ConfigurationError> {
  const issues: ErrorIssue[] = [];
  policy.targets.forEach((target, index) => {
    if (config.providers[target.provider] !== undefined) return;
    issues.push({
      path: `targets.${index}.provider`,
      message: `target ${target.id}: provider ${target.provider} needs ${REQUIRED_SETTING[target.provider]}`,
    });
  });
  if (issues.length > 0) {
    return err(configurationError("Missing provider settings for the routing policy", issues));
  }
  return ok(undefined);
}
