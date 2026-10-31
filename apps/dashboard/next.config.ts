import { resolve } from "node:path";
import type { NextConfig } from "next";

/** The workspace root: the standalone output traces workspace packages from there. */
const workspaceRoot = resolve(import.meta.dirname, "../..");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
