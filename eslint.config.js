// @ts-check
import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import vitest from "@vitest/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  // tools/img-to-object/upstream is vendored Apache-2.0 code with its own tests (bun run forge:test).
  globalIgnores(["**/dist/", "**/.turbo/", "**/.astro/", "**/coverage/", "playwright-report/", "test-results/", "**/*.cjs", "apps/site/astro.config.mjs", "tools/img-to-object/upstream/"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  comments.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // No escape hatches: take unknown and narrow it, or parse it with Zod.
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true }],
      // Every suppression names its rule and says why.
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "no-await-in-loop": "error",
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    // This file wires untyped plugins together; type-aware rules don't apply to it.
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.tsx"],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
    },
  },
);
