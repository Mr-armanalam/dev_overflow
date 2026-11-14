/**
 * ESLint 9 flat config (Wave 4). Replaces the legacy `.eslintrc.json`
 * (ESLint 8, EOL — and un-runnable: `npx eslint .` crashed in
 * `@eslint/eslintrc` while validating it, and `eslint-config-next`
 * 16.4.6 peers `eslint >=9.0.0`).
 *
 * `next lint` was removed in Next 16 — run ESLint directly:
 * `npm run lint` → `eslint .`.
 *
 * Order matters — later entries win on conflicting rules:
 * 1. typescript-eslint recommended, then React recommended, then
 *    Next's configs, so Next's choices (e.g. `react/prop-types: off`
 *    for TypeScript) win over the generic presets.
 * 2. `jsx-runtime` after Next, so `react/react-in-jsx-scope` stays
 *    off under the new JSX transform (`jsx: react-jsx`).
 * 3. `eslint-config-prettier` last, so it can switch off the
 *    formatting rules that conflict with Prettier.
 *
 * DROPPED vs the old `.eslintrc.json`: `eslint-config-standard`
 * (v17.1.0 is the latest and peers `eslint ^8.0.1` only — no
 * ESLint 9-compatible release exists; it also peered
 * `eslint-plugin-import`, `eslint-plugin-n ^15/16` and
 * `eslint-plugin-promise ^6`, none of which this repo installs).
 * Its rules were largely redundant with `next/core-web-vitals` +
 * `next/typescript` anyway. `eslint-plugin-n` / `eslint-plugin-promise`
 * (standard's deps) were removed with it.
 */
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import tailwindcss from "eslint-plugin-tailwindcss";
import prettier from "eslint-config-prettier";

export default defineConfig([
  globalIgnores([".next/**", "node_modules/**", "out/**", "coverage/**"]),

  // TypeScript + React presets first — Next's configs override them.
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,

  // Next.js: core-web-vitals + TypeScript (includes eslint:recommended
  // and the typescript-eslint recommended rules).
  ...nextVitals,
  ...nextTs,

  // New JSX transform: React need not be in scope for JSX.
  react.configs.flat["jsx-runtime"],

  // Tailwind class-order / arbitrary-value rules.
  tailwindcss.configs["flat/recommended"],

  // Repo rules carried over from the old `.eslintrc.json`.
  {
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "tailwindcss/classnames-order": "warn",
      "tailwindcss/enforces-negative-arbitrary-values": "error",
    },
  },

  // Last: switch off formatting rules that conflict with Prettier.
  prettier,
]);
