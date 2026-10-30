/**
 * A generic port double driven by a script (spec 002, research R-14).
 *
 * The script receives each input and its zero-based call index and returns the output
 * (or a promise of it); every input is recorded in order before the script runs. The
 * gateway types the script, for example as `LlmProviderPort["complete"]`, so this
 * package stays free of gateway types and never imports an app (research R-09).
 */
export interface ScriptedPort<I, O> {
  /** The port operation to hand to the code under test. */
  readonly fn: (input: I) => Promise<O>;
  /** Every input received, in call order. */
  readonly calls: ReadonlyArray<I>;
}

export function createScriptedPort<I, O>(
  script: (input: I, call: number) => O | Promise<O>,
): ScriptedPort<I, O> {
  const calls: I[] = [];

  return {
    fn: async (input) => {
      const call = calls.length;
      calls.push(input);
      return script(input, call);
    },
    calls,
  };
}
