import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    rules: {
      "import/no-cycle": "error",
      "import/no-extraneous-dependencies": [
        "error",
        {
          packageDir: [
            ".",
            "./packages/cli",
            "./packages/core",
            "./packages/viewer",
          ],
        },
      ],
    },
    settings: {
      "import/resolver": {
        typescript: {
          project: ["./tsconfig.base.json", "./packages/*/tsconfig.json"],
        },
      },
    },
  },
  {
    files: ["scripts/**/*.mjs", "packages/*/scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", fetch: "readonly", setTimeout: "readonly" },
    },
  },
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"] },
);
