import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HealthResponseSchema } from "@tamiz/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Spec 001, US4 scenario 1 (FR-015) and FR-020: the real process refuses an invalid
// environment with exit code 1 and a clear message, and serves /health with a valid one.
// Spec 002 US2-1 and US2-3 (tasks.md T047): it also refuses an invalid policy file and a
// policy whose providers are not configured, before binding a port. Spec 003 US2-3
// (tasks.md T028): and a policy whose chain contradicts its own residency statement.
// This is the only test in the package that spawns a process and opens a port.

const gatewayDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOT_TIMEOUT_MS = 15_000;

interface StartupLine {
  readonly msg?: unknown;
  readonly port?: unknown;
  readonly host?: unknown;
  readonly version?: unknown;
  readonly policyId?: unknown;
  readonly policyVersion?: unknown;
}

interface Exit {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Settings a developer may have exported; stripped so each test states its own. */
const GATEWAY_SETTINGS =
  /^(TAMIZ_.*|OLLAMA_BASE_URL|(MISTRAL|ANTHROPIC|OPENAI)_(API_KEY|BASE_URL))$/;

function inheritedEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !GATEWAY_SETTINGS.test(name)),
  );
}

/** Test values, never real credentials: no provider is called during boot. */
const ALL_PROVIDER_KEYS = {
  TAMIZ_API_KEYS: `demo:${"0".repeat(64)}`,
  MISTRAL_API_KEY: "test-mistral-key-SECRET",
  ANTHROPIC_API_KEY: "test-anthropic-key-SECRET",
  OPENAI_API_KEY: "test-openai-key-SECRET",
} as const;

function spawnGateway(env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: gatewayDir,
    env: { ...inheritedEnv(), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function collect(child: ChildProcess): { stdout: () => string; stderr: () => string } {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  return { stdout: () => stdout, stderr: () => stderr };
}

function waitForExit(child: ChildProcess, output: ReturnType<typeof collect>): Promise<Exit> {
  return new Promise((resolveExit) => {
    child.on("exit", (code) => {
      resolveExit({ code, stdout: output.stdout(), stderr: output.stderr() });
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not determine a free port"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function pollHealth(
  port: number,
  child: ChildProcess,
  deadlineMs: number,
): Promise<Response> {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`gateway exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status === 200) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`gateway did not answer /health in time: ${String(lastError)}`);
}

describe("gateway process boot", () => {
  let child: ChildProcess | undefined;

  afterEach(async () => {
    if (child !== undefined && child.exitCode === null) {
      const exited = new Promise<void>((r) => child?.once("exit", () => r()));
      child.kill();
      await exited;
    }
    child = undefined;
  });

  it(
    "US4-1: exits with code 1 and names every invalid variable when the env is invalid",
    async () => {
      child = spawnGateway({ PORT: "abc", LOG_LEVEL: "loud" });
      const exit = await waitForExit(child, collect(child));

      expect(exit.code).toBe(1);
      expect(exit.stderr).toContain("PORT");
      expect(exit.stderr).toContain("LOG_LEVEL");
      expect(exit.stderr).toMatch(/1.*65535/);
      expect(exit.stderr).not.toContain("abc");
      expect(exit.stderr).not.toContain("loud");
      expect(exit.stdout).not.toContain("gateway listening");
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    "FR-020: serves /health over HTTP and logs one startup line with a valid env",
    async () => {
      const port = await freePort();
      child = spawnGateway({
        PORT: String(port),
        HOST: "127.0.0.1",
        LOG_LEVEL: "info",
        ...ALL_PROVIDER_KEYS,
      });
      const output = collect(child);

      const response = await pollHealth(port, child, BOOT_TIMEOUT_MS - 3_000);

      expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
      const body = HealthResponseSchema.parse(await response.json());
      expect(body.status).toBe("ok");
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(body.uptimeMs).toBeGreaterThanOrEqual(0);

      const startupLine = output
        .stdout()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as StartupLine)
        .find((line) => line.msg === "gateway listening");
      expect(startupLine).toBeDefined();
      expect(startupLine?.port).toBe(port);
      expect(startupLine?.host).toBe("127.0.0.1");
      expect(startupLine?.version).toBe(body.version);
      expect(startupLine?.policyId).toBe("default");
      expect(startupLine?.policyVersion).toBe(2);
      expect(output.stdout()).not.toContain("SECRET");
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    "002 US2-1: exits with code 1 naming the path when the policy references an unknown target",
    async () => {
      child = spawnGateway({
        TAMIZ_POLICY_FILE: "test/policy/fixtures/invalid/unknown-target.yaml",
        ...ALL_PROVIDER_KEYS,
      });
      const exit = await waitForExit(child, collect(child));

      expect(exit.code).toBe(1);
      expect(exit.stderr).toContain("rules.0.route.0: expected the id of a declared target");
      expect(exit.stderr).toContain('(target "nope")');
      expect(exit.stderr).toContain("unknown-target.yaml");
      expect(exit.stdout).not.toContain("gateway listening");
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    "003 US2-3: exits with code 1 when a rule's chain contradicts its residency statement",
    async () => {
      child = spawnGateway({
        TAMIZ_POLICY_FILE: "test/policy/fixtures/invalid/residency-contradiction.yaml",
        ...ALL_PROVIDER_KEYS,
      });
      const exit = await waitForExit(child, collect(child));

      expect(exit.code).toBe(1);
      expect(exit.stderr).toContain("rules.0.route.1");
      expect(exit.stderr).toContain('target residency "us"');
      expect(exit.stdout).not.toContain("gateway listening");
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    "002 US2-3: exits with code 1 naming the missing setting, without printing configured keys",
    async () => {
      const { MISTRAL_API_KEY: _unset, ...otherKeys } = ALL_PROVIDER_KEYS;
      child = spawnGateway({ ...otherKeys });
      const exit = await waitForExit(child, collect(child));

      expect(exit.code).toBe(1);
      expect(exit.stderr).toContain("target mistral-small: provider mistral needs MISTRAL_API_KEY");
      expect(exit.stderr).not.toContain("SECRET");
      expect(exit.stdout).not.toContain("gateway listening");
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    "002 US5-4: exits with code 1 naming the entry position when TAMIZ_API_KEYS is malformed",
    async () => {
      child = spawnGateway({
        ...ALL_PROVIDER_KEYS,
        TAMIZ_API_KEYS: `demo:${"0".repeat(64)},not-a-valid-entry-SECRET`,
      });
      const exit = await waitForExit(child, collect(child));

      expect(exit.code).toBe(1);
      expect(exit.stderr).toContain("TAMIZ_API_KEYS[1]");
      expect(exit.stderr).not.toContain("SECRET");
      expect(exit.stdout).not.toContain("gateway listening");
    },
    BOOT_TIMEOUT_MS,
  );
});
