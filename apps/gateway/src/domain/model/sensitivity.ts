/**
 * Sensitivity of a request's content (spec 005 FR-001, data-model section 2.1).
 *
 * The four levels mean the same as the privacy service's (spec 004 FR-006); `unknown`
 * means inspection failed. An `Inspection` carries where personal data was found (message,
 * kind, offsets, score), never the values. Mirrored as `z.enum` in `@tamiz/contracts`.
 */

/** Ordered from least to most sensitive. */
export const SENSITIVITY_LEVELS = ["none", "low", "high", "critical"] as const;
export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];

export const SENSITIVITIES = ["unknown", ...SENSITIVITY_LEVELS] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** The privacy service's closed list of kinds (spec 004 FR-005). */
export const ENTITY_KINDS = [
  "DNI",
  "NIE",
  "CIF",
  "IBAN",
  "NSS",
  "PHONE",
  "EMAIL",
  "CREDIT_CARD",
  "PERSON",
  "LOCATION",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Where one piece of personal data is: UTF-16 offsets into one message's content. */
export interface DetectedEntity {
  readonly messageIndex: number;
  readonly kind: EntityKind;
  readonly start: number;
  readonly end: number;
  readonly score: number;
}

export const DETECTOR_FAILURES = ["unavailable", "timeout", "contract"] as const;
export type DetectorFailure = (typeof DETECTOR_FAILURES)[number];

export type Inspection =
  | {
      readonly status: "ok";
      readonly level: SensitivityLevel;
      readonly entities: ReadonlyArray<DetectedEntity>;
    }
  | { readonly status: "failed"; readonly reason: DetectorFailure };

export function sensitivityOf(inspection: Inspection): Sensitivity {
  return inspection.status === "ok" ? inspection.level : "unknown";
}

/**
 * Interim inspection used until the gateway calls the privacy service (spec 005 tasks.md
 * T009 → removed in T036): routes as level `none`, which keeps feature 003 behaviour.
 */
export const NOT_INSPECTED: Inspection = { status: "ok", level: "none", entities: [] };
