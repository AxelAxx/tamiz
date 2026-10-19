import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HealthResponseSchema } from "@tamiz/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Spec 001, US4 scenario 1 (FR-015) and FR-020: the real process refuses an invalid
// environment with exit code 1 and a clear message, and serves /health with a valid one.
// This is the only test in the package that spawns a process and opens a port.

const gatewayDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOT_TIMEOUT_MS = 15_000;

interface StartupLine {
  readonly msg?: unknown;
  readonly port?: unknown;
  readonly host?: unknown;
  readonly version?: unknown;
}

interface Exit {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function spawnGateway(env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: gatewayDir,
    env: { ...process.env, ...env },
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
      child = spawnGateway({ PORT: String(port), HOST: "127.0.0.1", LOG_LEVEL: "info" });
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
    },
    BOOT_TIMEOUT_MS,
  );
});
