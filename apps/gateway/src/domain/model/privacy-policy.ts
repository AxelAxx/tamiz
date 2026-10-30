/**
 * The policy's privacy section and the privacy step of the decision (spec 005 FR-002 …
 * FR-005, research R-04, R-11, data-model section 2.2).
 *
 * Each sensitivity level maps to an action and, optionally, the residencies its requests
 * may reach. `applyPrivacy` turns the rule's chain into what may actually run:
 * `allow` and `anonymize` keep the chain filtered to the allowed residencies,
 * `restrict_to_local` uses the local route, `block` (or nothing left) blocks. A failed
 * inspection applies `onDetectorError`, which never allows: the gateway fails closed.
 */

import type { TargetId } from "./brands.js";
import { type ModelTarget, RESIDENCIES, type Residency } from "./model-target.js";
import { type Inspection, SENSITIVITY_LEVELS, type SensitivityLevel } from "./sensitivity.js";

/** Same shape as `ErrorIssue` in `errors.ts`, which imports this module's types. */
export interface PrivacyIssue {
  readonly path: string;
  readonly message: string;
}

export const PRIVACY_ACTIONS = ["allow", "anonymize", "restrict_to_local", "block"] as const;
export type PrivacyAction = (typeof PRIVACY_ACTIONS)[number];
/** Actions that still send the request somewhere. */
export type RouteAction = Exclude<PrivacyAction, "block">;

/** What a failed inspection does: never `allow` (constitution VI). */
export const DETECTOR_ERROR_ACTIONS = ["restrict_to_local", "block"] as const;
export type DetectorErrorAction = (typeof DETECTOR_ERROR_ACTIONS)[number];

export const BLOCK_REASONS = ["action", "no_target", "detector_unavailable"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

/** Raw values of a critical request may go in clear only to these (FR-004). */
const CRITICAL_ALLOW_RESIDENCIES: ReadonlyArray<Residency> = ["local", "eu"];

export interface PrivacyLevelSettings {
  readonly action: PrivacyAction;
  /** Narrows where this level's requests may go; absent = wherever the rule allows. */
  readonly residency?: ReadonlyArray<Residency>;
}

export interface PrivacySettings {
  readonly onDetectorError: DetectorErrorAction;
  /** Local targets used by `restrict_to_local`. */
  readonly localRoute: ReadonlyArray<TargetId>;
  readonly levels: Readonly<Record<SensitivityLevel, PrivacyLevelSettings>>;
}

/** Unbranded input, as the policy schema produces it. */
export interface PrivacySettingsInput {
  readonly onDetectorError: DetectorErrorAction;
  readonly localRoute: ReadonlyArray<string>;
  readonly levels: Readonly<Record<SensitivityLevel, PrivacyLevelSettings>>;
}

/**
 * Cross-field checks of the privacy section; every issue names a path and policy data
 * only. `declared` maps each declared target id to its residency.
 */
export function validatePrivacy(
  input: PrivacySettingsInput | undefined,
  declared: ReadonlyMap<string, Residency>,
): { readonly settings?: PrivacySettings; readonly issues: ReadonlyArray<PrivacyIssue> } {
  if (input === undefined) {
    return { issues: [{ path: "privacy", message: "expected a privacy section" }] };
  }
  const issues: PrivacyIssue[] = [];
  if (input.localRoute.length === 0) {
    issues.push({ path: "privacy.localRoute", message: "expected at least one target id" });
  }
  input.localRoute.forEach((id, index) => {
    const residency = declared.get(id);
    const path = `privacy.localRoute.${index}`;
    if (residency === undefined) {
      issues.push({ path, message: "expected the id of a declared target" });
    } else if (residency !== "local") {
      issues.push({ path, message: `expected a local target (target residency "${residency}")` });
    } else if (input.localRoute.indexOf(id) !== index) {
      issues.push({ path, message: "expected each target at most once" });
    }
  });
  for (const level of SENSITIVITY_LEVELS) {
    const settings = input.levels[level];
    const residency = settings.residency;
    if (residency !== undefined && residency.length === 0) {
      issues.push({
        path: `privacy.levels.${level}.residency`,
        message: "expected at least one residency",
      });
    }
  }
  const critical = input.levels.critical;
  const criticalResidency = critical.residency;
  if (
    critical.action === "allow" &&
    (criticalResidency === undefined ||
      criticalResidency.some((r) => !CRITICAL_ALLOW_RESIDENCIES.includes(r)))
  ) {
    issues.push({
      path: "privacy.levels.critical",
      message:
        "expected critical data in clear to be limited to residencies local and eu (set residency, or use anonymize, restrict_to_local or block)",
    });
  }
  if (issues.length > 0) return { issues };
  return {
    issues,
    settings: {
      onDetectorError: input.onDetectorError,
      localRoute: input.localRoute.map((id) => id as TargetId),
      levels: input.levels,
    },
  };
}

export type PrivacyOutcome =
  | {
      readonly kind: "route";
      readonly action: RouteAction;
      readonly chain: ReadonlyArray<ModelTarget>;
      readonly allowedResidencies: ReadonlyArray<Residency>;
    }
  | { readonly kind: "block"; readonly reason: BlockReason };

export interface PrivacyStepInput {
  /** The rule's (or default) chain, already ordered. */
  readonly chain: ReadonlyArray<ModelTarget>;
  /** The rule's (or default) residency statement; absent = every residency. */
  readonly ruleResidency?: ReadonlyArray<Residency>;
  readonly privacy: PrivacySettings;
  /** `privacy.localRoute` resolved to targets. */
  readonly localChain: ReadonlyArray<ModelTarget>;
  readonly inspection: Inspection;
}

const LOCAL_ONLY: ReadonlyArray<Residency> = ["local"];

/** The privacy step of `decide` (research R-04): pure and total. */
export function applyPrivacy(input: PrivacyStepInput): PrivacyOutcome {
  const { inspection, privacy } = input;
  if (inspection.status === "failed") {
    return privacy.onDetectorError === "block"
      ? { kind: "block", reason: "detector_unavailable" }
      : localOutcome(input.localChain);
  }
  const level = privacy.levels[inspection.level];
  switch (level.action) {
    case "block":
      return { kind: "block", reason: "action" };
    case "restrict_to_local":
      return localOutcome(input.localChain);
    case "allow":
    case "anonymize": {
      const ruleAllowed = input.ruleResidency ?? RESIDENCIES;
      const allowed = ruleAllowed.filter((r) => level.residency?.includes(r) ?? true);
      const chain = input.chain.filter((target) => allowed.includes(target.residency));
      if (chain.length === 0) return { kind: "block", reason: "no_target" };
      return { kind: "route", action: level.action, chain, allowedResidencies: allowed };
    }
  }
}

function localOutcome(localChain: ReadonlyArray<ModelTarget>): PrivacyOutcome {
  return {
    kind: "route",
    action: "restrict_to_local",
    chain: localChain,
    allowedResidencies: LOCAL_ONLY,
  };
}
