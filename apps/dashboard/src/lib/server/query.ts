import "server-only";

/** A validated query back to strings for `hc`, without the absent values. */
export function toQuery(values: Readonly<Record<string, unknown>>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query[key] = String(value);
  }
  return query;
}
