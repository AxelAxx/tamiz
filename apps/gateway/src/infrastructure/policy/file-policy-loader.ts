/**
 * Loads the routing policy file at boot (spec 002 FR-019, FR-020, research R-09).
 *
 * read → YAML parse (JSON is valid YAML, so `.json` files load too) →
 * `RoutingPolicySchema` → `validatePolicy`. Every failure becomes one
 * `ConfigurationError` listing each problem by path; nothing throws.
 *
 * The domain never echoes a value. Here the file is the operator's own, so an issue on a
 * chain entry also quotes the target id it names (US2-1: "names the unknown target").
 */
import { readFile } from "node:fs/promises";
import { type RoutingPolicyDto, RoutingPolicySchema } from "@tamiz/contracts";
import { parse, YAMLParseError } from "yaml";
import {
  type ConfigurationError,
  configurationError,
  type ErrorIssue,
} from "../../domain/errors.js";
import { type RoutingPolicy, validatePolicy } from "../../domain/model/routing-policy.js";
import { err, ok, type Result } from "../../domain/result.js";
import { toDomainPolicyInput } from "./policy-mapper.js";

export async function loadPolicyFile(
  path: string,
): Promise<Result<RoutingPolicy, ConfigurationError>> {
  const failure = (message: string, issues: ConfigurationError["issues"]) =>
    err(configurationError(`${message} ${path}`, issues));

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return failure("Cannot read policy file", [
      { path, message: "expected a readable policy file" },
    ]);
  }

  let document: unknown;
  try {
    document = parse(text);
  } catch (error) {
    const where =
      error instanceof YAMLParseError && error.linePos !== undefined
        ? ` (line ${error.linePos[0].line})`
        : "";
    return failure("Cannot parse policy file", [
      { path, message: `expected valid YAML or JSON${where}` },
    ]);
  }

  const parsed = RoutingPolicySchema.safeParse(document);
  if (!parsed.success) {
    return failure(
      "Invalid routing policy in",
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }

  const policy = validatePolicy(toDomainPolicyInput(parsed.data));
  if (!policy.ok) {
    return failure(
      "Invalid routing policy in",
      policy.error.issues.map((issue) => quoteChainEntry(issue, parsed.data)),
    );
  }
  return ok(policy.value);
}

const CHAIN_ENTRY_PATH = /^(?:rules\.(\d+)\.route|default\.route)\.(\d+)$/;

function quoteChainEntry(issue: ErrorIssue, dto: RoutingPolicyDto): ErrorIssue {
  const match = CHAIN_ENTRY_PATH.exec(issue.path);
  if (match === null) return issue;
  const [, ruleIndex, entryIndex] = match;
  const route = ruleIndex === undefined ? dto.default.route : dto.rules[Number(ruleIndex)]?.route;
  const id = route?.[Number(entryIndex)];
  return id === undefined ? issue : { ...issue, message: `${issue.message} (target "${id}")` };
}
