/**
 * Type-level tests for the branded types (spec US2-8, FR-011).
 * Run by Vitest's typecheck mode (`vitest.config.ts`); a wrong assignment fails the run.
 */
import { describe, expectTypeOf, it } from "vitest";
import {
  type Milliseconds,
  milliseconds,
  type PolicyId,
  policyId,
  type RequestId,
  requestId,
  type Usd,
  usd,
} from "../src/index.js";

describe("branded types are nominal", () => {
  it("Usd is not assignable to Milliseconds (and vice versa)", () => {
    expectTypeOf<Usd>().not.toExtend<Milliseconds>();
    expectTypeOf<Milliseconds>().not.toExtend<Usd>();

    const cost: Usd = usd(1);
    // @ts-expect-error a cost is not a duration
    const duration: Milliseconds = cost;
    void duration;
  });

  it("RequestId is not assignable to PolicyId (and vice versa)", () => {
    expectTypeOf<RequestId>().not.toExtend<PolicyId>();
    expectTypeOf<PolicyId>().not.toExtend<RequestId>();

    const request: RequestId = requestId("req-1");
    // @ts-expect-error a request id is not a policy id
    const policy: PolicyId = request;
    void policy;
  });

  it("a plain string is not assignable to RequestId without the constructor", () => {
    expectTypeOf<string>().not.toExtend<RequestId>();

    // @ts-expect-error raw strings must go through requestId()
    const fromLiteral: RequestId = "req-1";
    void fromLiteral;

    const raw: string = "req-1";
    // @ts-expect-error raw strings must go through requestId()
    const fromVariable: RequestId = raw;
    void fromVariable;
  });

  it("a plain number is not assignable to Usd or Milliseconds", () => {
    expectTypeOf<number>().not.toExtend<Usd>();
    expectTypeOf<number>().not.toExtend<Milliseconds>();

    // @ts-expect-error raw numbers must go through usd()
    const cost: Usd = 1;
    // @ts-expect-error raw numbers must go through milliseconds()
    const duration: Milliseconds = 1;
    void cost;
    void duration;
  });

  it("branded values still extend their primitive, so they can be used as such", () => {
    expectTypeOf<RequestId>().toExtend<string>();
    expectTypeOf<PolicyId>().toExtend<string>();
    expectTypeOf<Usd>().toExtend<number>();
    expectTypeOf<Milliseconds>().toExtend<number>();

    const total: number = usd(1) + usd(2);
    void total;
  });

  it("constructors return the branded type", () => {
    expectTypeOf(requestId).returns.toEqualTypeOf<RequestId>();
    expectTypeOf(policyId).returns.toEqualTypeOf<PolicyId>();
    expectTypeOf(usd).returns.toEqualTypeOf<Usd>();
    expectTypeOf(milliseconds).returns.toEqualTypeOf<Milliseconds>();
  });
});
