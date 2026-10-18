import type { UserConfig } from "@commitlint/types";

// Conventional Commits, enforced locally by the husky commit-msg hook and in CI.
// Types follow the constitution ("Code conventions") plus perf, style and revert.
const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "test",
        "refactor",
        "ci",
        "build",
        "perf",
        "style",
        "revert",
      ],
    ],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [1, "always", 100],
  },
};

export default config;
