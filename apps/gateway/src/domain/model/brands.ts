/**
 * The branded unit and identifier types of the domain (spec 002 research R-01), with no
 * imports, so that `errors.ts` can name them without an import cycle through the
 * validating constructors of `units.ts` (which import `errors.ts`). Everything else
 * imports these types from `units.ts`, which re-exports them.
 */
declare const usdBrand: unique symbol;
declare const millisecondsBrand: unique symbol;
declare const policyIdBrand: unique symbol;
declare const targetIdBrand: unique symbol;
declare const ruleIdBrand: unique symbol;
declare const requestIdBrand: unique symbol;
declare const clientIdBrand: unique symbol;

/** A cost or price in US dollars; finite and never negative. */
export type Usd = number & { readonly [usdBrand]: true };
/** A duration in whole milliseconds; never negative. */
export type Milliseconds = number & { readonly [millisecondsBrand]: true };
/** Identifies a routing policy document. */
export type PolicyId = string & { readonly [policyIdBrand]: true };
/** Identifies a model target inside a policy. */
export type TargetId = string & { readonly [targetIdBrand]: true };
/** Identifies a routing rule inside a policy. */
export type RuleId = string & { readonly [ruleIdBrand]: true };
/** Correlates a request across headers, logs and audit entries. */
export type RequestId = string & { readonly [requestIdBrand]: true };
/** Identifies the client application that owns an API key. */
export type ClientId = string & { readonly [clientIdBrand]: true };
