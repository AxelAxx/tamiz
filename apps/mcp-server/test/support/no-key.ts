import { expect } from "vitest";

/**
 * Asserts a key appears in none of the given values (spec 009 US2-4, SC-003): tool lists,
 * results, errors and log lines are serialised and searched for the key string.
 */
export function expectNoKey(key: string, ...values: unknown[]): void {
  for (const value of values) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    expect(text, "a gateway key leaked into tool data or logs").not.toContain(key);
  }
}
